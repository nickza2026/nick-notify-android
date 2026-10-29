package backend

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// One owner row serializes credential checks across API instances. This process
// bound also covers bootstrap hashing and prevents unbounded CPU work.
var dashboardHashSlots = make(chan struct{}, 2)
var dashboardUsername = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,64}$`)
var dashboardToken = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

func passwordHash(password string) (string, error) {
	salt := make([]byte, 16)
	if _, e := rand.Read(salt); e != nil {
		return "", e
	}
	key, e := pbkdf2.Key(sha256.New, password, salt, 600000, 32)
	if e != nil {
		return "", e
	}
	return "pbkdf2-sha256$v1$600000$" + base64.RawURLEncoding.EncodeToString(salt) + "$" + base64.RawURLEncoding.EncodeToString(key), nil
}

func passwordMatches(password, encoded string) (bool, error) {
	p := strings.Split(encoded, "$")
	if len(p) != 5 || p[0] != "pbkdf2-sha256" || p[1] != "v1" || p[2] != "600000" {
		return false, errors.New("invalid stored password format")
	}
	salt, e := base64.RawURLEncoding.Strict().DecodeString(p[3])
	if e != nil || len(salt) != 16 {
		return false, errors.New("invalid stored salt")
	}
	want, e := base64.RawURLEncoding.Strict().DecodeString(p[4])
	if e != nil || len(want) != 32 {
		return false, errors.New("invalid stored key")
	}
	got, e := pbkdf2.Key(sha256.New, password, salt, 600000, 32)
	return subtle.ConstantTimeCompare(got, want) == 1, e
}

// BootstrapDashboard initializes exactly one case-sensitive owner, once. An
// existing owner is never rehashed or reset, even with changed environment values.
func BootstrapDashboard(ctx context.Context, db *sql.DB, username, password string) error {
	if password == "" {
		return nil
	}
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(739148522)`); e != nil {
		return e
	}
	var exists bool
	if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dashboard_owner)`).Scan(&exists); e != nil {
		return e
	}
	if exists {
		return tx.Commit()
	}
	if username == "" {
		username = "admin"
	}
	if !dashboardUsername.MatchString(username) || !utf8.ValidString(password) || len(password) < 32 || len(password) > 128 {
		return errors.New("invalid dashboard bootstrap configuration")
	}
	select {
	case dashboardHashSlots <- struct{}{}:
		defer func() { <-dashboardHashSlots }()
	case <-ctx.Done():
		return ctx.Err()
	}
	hash, e := passwordHash(password)
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO dashboard_owner(id,username,password_hash,bootstrap_hash) VALUES(1,$1,$2,$2)`, username, hash); e != nil {
		return e
	}
	return tx.Commit()
}

type dashboardOwner struct {
	username, hash, bootstrapHash string
	restricted                    bool
	failures, changes             int
	window, changeWindow          sql.NullTime
}
type dashboardUser struct {
	Username   string `json:"username"`
	MustChange bool   `json:"must_change_password"`
}

func (o dashboardOwner) user() dashboardUser { return dashboardUser{o.username, o.restricted} }

func newDashboardSession(ctx context.Context, tx *sql.Tx, now time.Time) (string, time.Time, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", time.Time{}, e
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	expiry := now.Add(24 * time.Hour)
	if _, e := tx.ExecContext(ctx, `DELETE FROM dashboard_sessions WHERE expires_at <= $1`, now); e != nil {
		return "", expiry, e
	}
	// Keep at most nine prior sessions, plus this new session (absolute expiry).
	if _, e := tx.ExecContext(ctx, `DELETE FROM dashboard_sessions WHERE token_hash IN (SELECT token_hash FROM dashboard_sessions ORDER BY created_at DESC, token_hash OFFSET 9)`); e != nil {
		return "", expiry, e
	}
	_, e := tx.ExecContext(ctx, `INSERT INTO dashboard_sessions(token_hash,owner_id,created_at,expires_at) VALUES($1,1,$2,$3)`, digest(token), now, expiry)
	return token, expiry, e
}

func dashboardDecode(r *http.Request, v any) error {
	if e := decode(r, v); e != nil {
		return fail(400, "invalid_schema")
	}
	return nil
}

// Public Web callers reach these routes with the BFF's app key. Keep their
// admission separate from operational alert/capability-Ack capacity, including
// bad session cookies, logout spam and already-throttled password attempts.
func (a *API) dashboardAllowed(ok bool) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if now := a.now(); now.Sub(a.dashboardWindow) >= time.Minute {
		a.dashboardWindow = now
		a.dashboardValid, a.dashboardInvalid = 0, 0
	}
	if ok {
		a.dashboardValid++
		return a.dashboardValid <= 120
	}
	a.dashboardInvalid++
	return a.dashboardInvalid <= 60
}

func (a *API) acquireDashboard() bool {
	a.mu.Lock()
	if a.dashboardConcurrent == nil {
		a.dashboardConcurrent = make(chan struct{}, 2)
	}
	ch := a.dashboardConcurrent
	a.mu.Unlock()
	select {
	case ch <- struct{}{}:
		return true
	default:
		return false
	}
}

func (a *API) serveDashboard(w http.ResponseWriter, r *http.Request) {
	ok := a.appAuthorized(r)
	if !a.dashboardAllowed(ok) {
		w.Header().Set("Retry-After", "60")
		failure(w, fail(429, "rate_limited"))
		return
	}
	if !ok {
		failure(w, fail(401, "unauthorized"))
		return
	}
	if !a.acquireDashboard() {
		w.Header().Set("Retry-After", "1")
		failure(w, fail(429, "rate_limited"))
		return
	}
	defer func() { <-a.dashboardConcurrent }()
	if e := a.dashboard(w, r); e != nil {
		failure(w, e)
	}
}

func (a *API) dashboard(w http.ResponseWriter, r *http.Request) error {
	path := strings.TrimPrefix(r.URL.Path, "/v1/dashboard")
	login := r.Method == "POST" && path == "/login"
	change := r.Method == "POST" && path == "/change-password"
	logout := r.Method == "POST" && path == "/logout"
	session := r.Method == "GET" && path == "/session"
	alertID := strings.TrimPrefix(path, "/alerts/")
	getAlert := r.Method == "GET" && strings.HasPrefix(path, "/alerts/") && validID(alertID)
	history := r.Method == "GET" && path == "/history"
	stats := r.Method == "GET" && path == "/stats"
	create := r.Method == "POST" && path == "/alerts"
	if !login && !change && !logout && !session && !getAlert && !history && !stats && !create {
		return fail(404, "not_found")
	}
	var credentials struct {
		Username *string `json:"username"`
		Password *string `json:"password"`
	}
	var replacement struct {
		Current *string `json:"current_password"`
		New     *string `json:"new_password"`
	}
	if login {
		if e := dashboardDecode(r, &credentials); e != nil {
			return e
		}
		if credentials.Username == nil || credentials.Password == nil || len(*credentials.Username) > 64 || len(*credentials.Password) > 128 || !utf8.ValidString(*credentials.Password) {
			return fail(400, "invalid_schema")
		}
	}
	if change {
		if e := dashboardDecode(r, &replacement); e != nil {
			return e
		}
		if replacement.Current == nil || replacement.New == nil || len(*replacement.Current) > 128 || !utf8.ValidString(*replacement.Current) {
			return fail(400, "invalid_schema")
		}
		if !utf8.ValidString(*replacement.New) || len(*replacement.New) > 128 || utf8.RuneCountInString(*replacement.New) < 15 {
			return fail(422, "invalid_password")
		}
	}
	tx, e := a.DB.BeginTx(r.Context(), nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var o dashboardOwner
	e = tx.QueryRowContext(r.Context(), `SELECT username,password_hash,bootstrap_hash,must_change_password,login_failures,login_window,change_failures,change_window FROM dashboard_owner WHERE id=1 FOR UPDATE`).Scan(&o.username, &o.hash, &o.bootstrapHash, &o.restricted, &o.failures, &o.window, &o.changes, &o.changeWindow)
	if e == sql.ErrNoRows {
		if logout {
			respond(w, 200, map[string]bool{"ok": true})
			return nil
		}
		if login {
			return fail(503, "dashboard_not_configured")
		}
		return fail(401, "session_required")
	}
	if e != nil {
		return e
	}
	now := a.now()
	token := r.Header.Get("X-Dashboard-Session")
	var expiry time.Time
	if !login {
		if dashboardToken.MatchString(token) {
			e = tx.QueryRowContext(r.Context(), `SELECT expires_at FROM dashboard_sessions WHERE token_hash=$1 AND expires_at>$2`, digest(token), now).Scan(&expiry)
		} else {
			e = sql.ErrNoRows
		}
		if logout {
			if e != nil && e != sql.ErrNoRows {
				return e
			}
			if _, e = tx.ExecContext(r.Context(), `DELETE FROM dashboard_sessions WHERE token_hash=$1 OR expires_at<=$2`, digest(token), now); e != nil {
				return e
			}
			if e = tx.Commit(); e != nil {
				return e
			}
			respond(w, 200, map[string]bool{"ok": true})
			return nil
		}
		if e == sql.ErrNoRows {
			return fail(401, "session_required")
		}
		if e != nil {
			return e
		}
	}
	if login || change {
		count, window := o.failures, o.window
		if change {
			count, window = o.changes, o.changeWindow
		}
		if window.Valid && now.Before(window.Time.Add(time.Minute)) && count >= 5 {
			w.Header().Set("Retry-After", "60")
			return fail(429, "rate_limited")
		}
		select {
		case dashboardHashSlots <- struct{}{}:
			defer func() { <-dashboardHashSlots }()
		default:
			w.Header().Set("Retry-After", "1")
			return fail(429, "rate_limited")
		}
		password := ""
		if login {
			password = *credentials.Password
		} else {
			password = *replacement.Current
		}
		matches, err := passwordMatches(password, o.hash)
		if err != nil {
			return err
		}
		if login && *credentials.Username != o.username {
			matches = false
		}
		if !matches {
			if !window.Valid || !now.Before(window.Time.Add(time.Minute)) {
				count = 0
				window = sql.NullTime{Time: now, Valid: true}
			}
			query := `UPDATE dashboard_owner SET login_failures=$1,login_window=$2 WHERE id=1`
			if change {
				query = `UPDATE dashboard_owner SET change_failures=$1,change_window=$2 WHERE id=1`
			}
			if _, e = tx.ExecContext(r.Context(), query, count+1, window.Time); e != nil {
				return e
			}
			if e = tx.Commit(); e != nil {
				return e
			}
			return fail(401, "invalid_credentials")
		}
		if change {
			if subtle.ConstantTimeCompare([]byte(*replacement.Current), []byte(*replacement.New)) == 1 {
				return fail(422, "password_unchanged")
			}
			bootstrapMatch, err := passwordMatches(*replacement.New, o.bootstrapHash)
			if err != nil {
				return err
			}
			if bootstrapMatch {
				return fail(422, "password_unchanged")
			}
			hash, err := passwordHash(*replacement.New)
			if err != nil {
				return err
			}
			if _, e = tx.ExecContext(r.Context(), `UPDATE dashboard_owner SET password_hash=$1,must_change_password=false,change_failures=0,change_window=NULL WHERE id=1`, hash); e != nil {
				return e
			}
			if _, e = tx.ExecContext(r.Context(), `DELETE FROM dashboard_sessions`); e != nil {
				return e
			}
			o.restricted = false
		}
		if _, e = tx.ExecContext(r.Context(), `UPDATE dashboard_owner SET login_failures=0,login_window=NULL WHERE id=1`); e != nil {
			return e
		}
		token, expiry, e = newDashboardSession(r.Context(), tx, now)
		if e != nil {
			return e
		}
		if e = tx.Commit(); e != nil {
			return e
		}
		respond(w, 200, map[string]any{"user": o.user(), "session_token": token, "expires_at": expiry})
		return nil
	}
	if !session && o.restricted {
		return fail(403, "password_change_required")
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	switch {
	case session:
		respond(w, 200, map[string]any{"user": o.user(), "expires_at": expiry})
		return nil
	case history:
		return a.history(w, r)
	case stats:
		return a.stats(w, r)
	case getAlert:
		return a.get(w, r, alertID)
	case create:
		return a.create(w, r)
	}
	return fail(404, "not_found")
}

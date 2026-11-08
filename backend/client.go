package backend

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

const primaryKeyName = "การแจ้งเตือนหลัก"

type deviceItem struct {
	ID           string    `json:"device_id"`
	Installation string    `json:"installation_id"`
	Name         string    `json:"device_name"`
	KeyIDs       []string  `json:"key_ids"`
	Active       bool      `json:"active"`
	Created      time.Time `json:"created_at"`
	Updated      time.Time `json:"updated_at"`
}

func (a *API) devices(ctx context.Context) ([]deviceItem, error) {
	rows, e := a.DB.QueryContext(ctx, `SELECT d.id::text,d.installation_id::text,d.device_name,d.active,d.created_at,d.updated_at FROM client_devices d WHERE d.owner_id=1 ORDER BY d.created_at,d.id`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []deviceItem{}
	for rows.Next() {
		var d deviceItem
		if e = rows.Scan(&d.ID, &d.Installation, &d.Name, &d.Active, &d.Created, &d.Updated); e != nil {
			return nil, e
		}
		d.KeyIDs = []string{"primary"}
		d.Created = d.Created.UTC()
		d.Updated = d.Updated.UTC()
		items = append(items, d)
	}
	return items, rows.Err()
}

func (a *API) revokeDevice(ctx context.Context, id string, installation bool) error {
	tx, e := a.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, `SELECT id FROM dashboard_owner WHERE id=1 FOR UPDATE`); e != nil {
		return e
	}
	col := "id"
	if installation {
		col = "installation_id"
	}
	var install string
	e = tx.QueryRowContext(ctx, `SELECT installation_id::text FROM client_devices WHERE owner_id=1 AND `+col+`=$1`, id).Scan(&install)
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `DELETE FROM client_sessions WHERE installation_id=$1`, install); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `DELETE FROM client_subscriptions WHERE device_id IN (SELECT id FROM client_devices WHERE installation_id=$1)`, install); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `UPDATE client_devices SET active=false,updated_at=$2 WHERE installation_id=$1`, install, a.now()); e != nil {
		return e
	}
	return tx.Commit()
}

func (a *API) serveClient(w http.ResponseWriter, r *http.Request) {
	if !a.dashboardAllowed(true) {
		w.Header().Set("Retry-After", "60")
		failure(w, fail(429, "rate_limited"))
		return
	}
	if !a.acquireDashboard() {
		w.Header().Set("Retry-After", "1")
		failure(w, fail(429, "rate_limited"))
		return
	}
	defer func() { <-a.dashboardConcurrent }()
	if e := a.client(w, r); e != nil {
		failure(w, e)
	}
}

func newClientSession(ctx context.Context, tx *sql.Tx, installation string, now time.Time) (string, time.Time, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", time.Time{}, e
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	expiry := now.Add(30 * 24 * time.Hour)
	// One current login per installation; expired bearers cannot accumulate forever.
	if _, e := tx.ExecContext(ctx, `DELETE FROM client_sessions WHERE installation_id=$1 OR expires_at<=$2`, installation, now); e != nil {
		return "", time.Time{}, e
	}
	_, e := tx.ExecContext(ctx, `INSERT INTO client_sessions(token_hash,owner_id,installation_id,created_at,expires_at) VALUES($1,1,$2,$3,$4)`, digest(token), installation, now, expiry)
	return token, expiry, e
}

func (a *API) client(w http.ResponseWriter, r *http.Request) error {
	path := strings.TrimPrefix(r.URL.Path, "/v1/client")
	login := r.Method == "POST" && path == "/login"
	change := r.Method == "POST" && path == "/change-password"
	register := r.Method == "POST" && path == "/devices/register"
	session := r.Method == "GET" && path == "/session"
	logout := r.Method == "POST" && path == "/logout"
	keys := r.Method == "GET" && path == "/keys"
	list := r.Method == "GET" && path == "/devices"
	if !login && !change && !register && !session && !logout && !keys && !list {
		return fail(404, "not_found")
	}
	var credentials struct {
		Username     *string `json:"username"`
		Password     *string `json:"password"`
		Installation *string `json:"installation_id"`
	}
	var replacement struct {
		Current *string `json:"current_password"`
		New     *string `json:"new_password"`
	}
	var registration struct {
		Key   *string `json:"key_id"`
		Name  *string `json:"device_name"`
		Token *string `json:"fcm_token"`
	}
	if login {
		if e := decode(r, &credentials); e != nil {
			return e
		}
		if credentials.Username == nil || len(*credentials.Username) > 64 {
			return fail(422, "invalid_username")
		}
		if credentials.Password == nil || len(*credentials.Password) > 128 || !utf8.ValidString(*credentials.Password) {
			return fail(422, "invalid_password")
		}
		if credentials.Installation == nil || !canonicalUUID(*credentials.Installation) {
			return fail(422, "invalid_installation_id")
		}
	}
	if change {
		if e := decode(r, &replacement); e != nil {
			return e
		}
		if replacement.Current == nil || len(*replacement.Current) > 128 || !utf8.ValidString(*replacement.Current) {
			return fail(422, "invalid_current_password")
		}
		if replacement.New == nil || !utf8.ValidString(*replacement.New) || len(*replacement.New) > 128 || utf8.RuneCountInString(*replacement.New) < 15 {
			return fail(422, "invalid_password")
		}
	}
	if register {
		if e := decode(r, &registration); e != nil {
			return e
		}
		if registration.Key == nil || *registration.Key != "primary" {
			return fail(422, "invalid_key_id")
		}
		if registration.Name == nil || utf8.RuneCountInString(*registration.Name) < 1 || utf8.RuneCountInString(*registration.Name) > 80 || strings.TrimSpace(*registration.Name) == "" || strings.ContainsFunc(*registration.Name, unicode.IsControl) {
			return fail(422, "invalid_device_name")
		}
		if registration.Token == nil || len(*registration.Token) < 20 || len(*registration.Token) > 4096 || strings.ContainsFunc(*registration.Token, func(r rune) bool { return r < 33 || r > 126 }) {
			return fail(422, "invalid_fcm_token")
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
		if login {
			return fail(503, "dashboard_not_configured")
		}
		return fail(401, "session_required")
	}
	if e != nil {
		return e
	}
	now := a.now()
	installation := ""
	var expiry time.Time
	if !login {
		token := bearer(r)
		if dashboardToken.MatchString(token) {
			e = tx.QueryRowContext(r.Context(), `SELECT installation_id::text,expires_at FROM client_sessions WHERE token_hash=$1 AND expires_at>$2`, digest(token), now).Scan(&installation, &expiry)
		} else {
			e = sql.ErrNoRows
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
			q := `UPDATE dashboard_owner SET login_failures=$1,login_window=$2 WHERE id=1`
			if change {
				q = `UPDATE dashboard_owner SET change_failures=$1,change_window=$2 WHERE id=1`
			}
			if _, e = tx.ExecContext(r.Context(), q, count+1, window.Time); e != nil {
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
			same, err := passwordMatches(*replacement.New, o.bootstrapHash)
			if err != nil {
				return err
			}
			if same {
				return fail(422, "password_unchanged")
			}
			hash, err := passwordHash(*replacement.New)
			if err != nil {
				return err
			}
			if _, e = tx.ExecContext(r.Context(), `UPDATE dashboard_owner SET password_hash=$1,must_change_password=false,change_failures=0,change_window=NULL,login_failures=0,login_window=NULL WHERE id=1`, hash); e != nil {
				return e
			}
			if _, e = tx.ExecContext(r.Context(), `DELETE FROM dashboard_sessions`); e != nil {
				return e
			}
			if _, e = tx.ExecContext(r.Context(), `DELETE FROM client_sessions`); e != nil {
				return e
			}
			o.restricted = false
		} else {
			installation = *credentials.Installation
			if _, e = tx.ExecContext(r.Context(), `UPDATE dashboard_owner SET login_failures=0,login_window=NULL WHERE id=1`); e != nil {
				return e
			}
		}
		var token string
		token, expiry, e = newClientSession(r.Context(), tx, installation, now)
		if e != nil {
			return e
		}
		if e = tx.Commit(); e != nil {
			return e
		}
		respond(w, 200, map[string]any{"access_token": token, "expires_at": expiry, "user": o.user()})
		return nil
	}
	if logout {
		if _, e = tx.ExecContext(r.Context(), `DELETE FROM client_sessions WHERE installation_id=$1`, installation); e != nil {
			return e
		}
		if _, e = tx.ExecContext(r.Context(), `DELETE FROM client_subscriptions WHERE device_id IN (SELECT id FROM client_devices WHERE installation_id=$1)`, installation); e != nil {
			return e
		}
		if _, e = tx.ExecContext(r.Context(), `UPDATE client_devices SET active=false,updated_at=$2 WHERE installation_id=$1`, installation, now); e != nil {
			return e
		}
		if e = tx.Commit(); e != nil {
			return e
		}
		respond(w, 200, map[string]bool{"logged_out": true})
		return nil
	}
	if !session && o.restricted {
		return fail(403, "password_change_required")
	}
	if register {
		if a.AckBase == "" {
			return fail(503, "ack_not_configured")
		}
		if len(a.DeviceTokenKey) != 32 {
			return fail(503, "device_registration_not_configured")
		}
		if a.Sender == nil {
			return fail(503, "fcm_not_configured")
		}
		if _, ok := a.Sender.(TargetSender); !ok {
			return fail(503, "targeted_sender_not_configured")
		}
		var configured bool
		if e = tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM client_keys WHERE key_id='primary' AND owner_id=1)`).Scan(&configured); e != nil {
			return e
		}
		if !configured {
			return fail(422, "invalid_key_id")
		}
		var managed bool
		if e = tx.QueryRowContext(r.Context(), `SELECT managed FROM client_keys WHERE key_id='primary' AND owner_id=1`).Scan(&managed); e != nil {
			return e
		}
		if !managed {
			if legacy, ok := a.Sender.(legacyTarget); ok && legacy.HasLegacyTarget() {
				provider, ok := a.Sender.(interface{ LegacyToken() string })
				if !ok || provider.LegacyToken() == "" {
					return fail(503, "legacy_target_unavailable")
				}
				legacyToken := provider.LegacyToken()
				sealed, err := a.sealToken(legacyToken)
				if err != nil {
					return err
				}
				oldID := uuid.NewString()
				_, e = tx.ExecContext(r.Context(), `INSERT INTO client_devices(id,owner_id,installation_id,device_name,legacy_import,active,created_at,updated_at) VALUES($1,1,$2,$3,true,true,$4,$4)`, oldID, uuid.NewString(), "เครื่องเดิมจากการตั้งค่า", now)
				if e != nil {
					return e
				}
				_, e = tx.ExecContext(r.Context(), `INSERT INTO client_subscriptions(device_id,key_id,token_hash,token_cipher) VALUES($1,'primary',$2,$3)`, oldID, digest(legacyToken), sealed)
				if e != nil {
					return e
				}
			}
		}
		ciphertext, err := a.sealToken(*registration.Token)
		if err != nil {
			return err
		}
		hash := digest(*registration.Token)
		var tokenDevice string
		var legacyImport bool
		e = tx.QueryRowContext(r.Context(), `SELECT d.id::text,d.legacy_import FROM client_subscriptions s JOIN client_devices d ON d.id=s.device_id WHERE s.token_hash=$1`, hash).Scan(&tokenDevice, &legacyImport)
		if e != nil && e != sql.ErrNoRows {
			return e
		}
		if tokenDevice != "" && !legacyImport {
			var owned bool
			if e = tx.QueryRowContext(r.Context(), `SELECT installation_id=$2 FROM client_devices WHERE id=$1`, tokenDevice, installation).Scan(&owned); e != nil {
				return e
			}
			if !owned {
				return fail(409, "fcm_token_conflict")
			}
		}
		var count int
		if e = tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM client_devices WHERE active AND installation_id<>$1`, installation).Scan(&count); e != nil {
			return e
		}
		if count >= 20 && !legacyImport {
			return fail(409, "device_limit_reached")
		}
		var deviceID string
		var created, updated time.Time
		if legacyImport {
			// A previously registered installation cannot steal an imported device.
			var existing string
			err := tx.QueryRowContext(r.Context(), `SELECT id::text FROM client_devices WHERE installation_id=$1`, installation).Scan(&existing)
			if err != nil && err != sql.ErrNoRows {
				return err
			}
			if existing != "" && existing != tokenDevice {
				return fail(409, "fcm_token_conflict")
			}
			e = tx.QueryRowContext(r.Context(), `UPDATE client_devices SET installation_id=$2,device_name=$3,legacy_import=false,active=true,updated_at=$4 WHERE id=$1 RETURNING id::text,created_at,updated_at`, tokenDevice, installation, *registration.Name, now).Scan(&deviceID, &created, &updated)
		} else {
			e = tx.QueryRowContext(r.Context(), `INSERT INTO client_devices(id,owner_id,installation_id,device_name,active,created_at,updated_at) VALUES($1,1,$2,$3,true,$4,$4) ON CONFLICT (installation_id) DO UPDATE SET device_name=EXCLUDED.device_name,active=true,updated_at=EXCLUDED.updated_at RETURNING id::text,created_at,updated_at`, uuid.NewString(), installation, *registration.Name, now).Scan(&deviceID, &created, &updated)
		}
		if e != nil {
			return e
		}
		if _, e = tx.ExecContext(r.Context(), `UPDATE client_keys SET managed=true WHERE key_id='primary' AND owner_id=1`); e != nil {
			return e
		}
		_, e = tx.ExecContext(r.Context(), `INSERT INTO client_subscriptions(device_id,key_id,token_hash,token_cipher) VALUES($1,'primary',$2,$3) ON CONFLICT (device_id,key_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,token_cipher=EXCLUDED.token_cipher`, deviceID, hash, ciphertext)
		if e != nil {
			var p *pq.Error
			if errors.As(e, &p) && p.Code == "23505" {
				return fail(409, "fcm_token_conflict")
			}
			return e
		}
		expiry = now.Add(30 * 24 * time.Hour)
		if _, e = tx.ExecContext(r.Context(), `UPDATE client_sessions SET expires_at=$2 WHERE token_hash=$1`, digest(bearer(r)), expiry); e != nil {
			return e
		}
		if e = tx.Commit(); e != nil {
			return e
		}
		respond(w, 200, map[string]any{"device_id": deviceID, "installation_id": installation, "key_id": "primary", "device_name": *registration.Name, "registered": true, "updated_at": updated.UTC()})
		return nil
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	if session {
		respond(w, 200, map[string]any{"expires_at": expiry, "user": o.user()})
		return nil
	}
	if keys {
		respond(w, 200, map[string]any{"items": []map[string]string{{"key_id": "primary", "name": primaryKeyName}}})
		return nil
	}
	items, e := a.devices(r.Context())
	if e != nil {
		return e
	}
	respond(w, 200, map[string]any{"items": items})
	return nil
}

func canonicalUUID(s string) bool { v, e := uuid.Parse(s); return e == nil && v.String() == s }
func (a *API) sealToken(token string) ([]byte, error) {
	block, e := aes.NewCipher(a.DeviceTokenKey)
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(block)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, g.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	return g.Seal(nonce, nonce, []byte(token), nil), nil
}
func (a *API) openToken(b []byte) (string, error) {
	block, e := aes.NewCipher(a.DeviceTokenKey)
	if e != nil {
		return "", e
	}
	g, e := cipher.NewGCM(block)
	if e != nil {
		return "", e
	}
	if len(b) < g.NonceSize() {
		return "", errors.New("invalid encrypted token")
	}
	v, e := g.Open(nil, b[:g.NonceSize()], b[g.NonceSize():], nil)
	return string(v), e
}

package backend

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const bodyLimit = 16384
const payloadLimit = 4000

type Sender interface {
	Send(context.Context, map[string]string, int) error
}
type SendError struct {
	Code      string
	Ambiguous bool
}

func (e *SendError) Error() string { return e.Code }

type API struct {
	DB                                  *sql.DB
	Key                                 string
	Sender                              Sender
	AckBase                             string
	Now                                 func() time.Time
	mu                                  sync.Mutex
	window                              time.Time
	authorized, invalid                 int
	RequestsPerMinute, InvalidPerMinute int
	MaxConcurrent                       int
	concurrent                          chan struct{}
	dashboardWindow                     time.Time
	dashboardValid, dashboardInvalid    int
	dashboardConcurrent                 chan struct{}
}
type apiError struct {
	status int
	code   string
}

func (e apiError) Error() string         { return e.code }
func fail(status int, code string) error { return apiError{status, code} }

func ValidateAckBase(v string) (string, error) {
	if v == "" {
		return "", nil
	}
	if len(v) > 1024 || strings.ContainsAny(v, "?#\\ \t\r\n") {
		return "", errors.New("invalid_ack_base_url")
	}
	u, e := url.Parse(v)
	if e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || u.ForceQuery {
		return "", errors.New("invalid_ack_base_url")
	}
	if u.String() != v {
		return "", errors.New("invalid_ack_base_url")
	}
	if u.EscapedPath() != "" && !regexp.MustCompile(`^/(?:[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*/?)?$`).MatchString(u.EscapedPath()) || u.RawPath != "" {
		return "", errors.New("invalid_ack_base_url")
	}
	for _, part := range strings.Split(u.Path, "/") {
		if part == "." || part == ".." {
			return "", errors.New("invalid_ack_base_url")
		}
	}
	return strings.TrimSuffix(v, "/"), nil
}

func (a *API) validate() error {
	if a.DB == nil || len([]byte(a.Key)) < 32 {
		return errors.New("database and ALERT_API_KEY (minimum 32 bytes) required")
	}
	base, e := ValidateAckBase(a.AckBase)
	a.AckBase = base
	return e
}
func (a *API) now() time.Time {
	if a.Now != nil {
		return a.Now().UTC().Truncate(time.Microsecond)
	}
	// PostgreSQL stores timestamps at microsecond precision; canonicalize before responding.
	return time.Now().UTC().Truncate(time.Microsecond)
}
func (a *API) allowed(ok bool) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	n := a.now()
	if n.Sub(a.window) >= time.Minute || a.window.IsZero() {
		a.window = n
		a.invalid = 0
		a.authorized = 0
	}
	if ok {
		a.authorized++
		max := a.RequestsPerMinute
		if max == 0 {
			max = 60
		}
		return a.authorized <= max
	}
	a.invalid++
	max := a.InvalidPerMinute
	if max == 0 {
		max = 60
	}
	return a.invalid <= max
}
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, e error) {
	var ae apiError
	if !errors.As(e, &ae) {
		ae = apiError{503, "temporarily_unavailable"}
	}
	respond(w, ae.status, map[string]any{"error": map[string]string{"code": ae.code}, "request_id": uuid.NewString()})
}
func bearer(r *http.Request) string {
	v := r.Header.Get("Authorization")
	if !strings.HasPrefix(v, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(v, "Bearer ")
}
func (a *API) appAuthorized(r *http.Request) bool {
	t := bearer(r)
	if t == "" {
		return false
	}
	return subtle.ConstantTimeCompare(digest(t), digest(a.Key)) == 1
}
func (a *API) capAuthorized(ctx context.Context, id string, r *http.Request) (bool, error) {
	t := bearer(r)
	if len(t) != 43 || !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(t) {
		return false, nil
	}
	var stored []byte
	err := a.DB.QueryRowContext(ctx, `SELECT capability_hash FROM alerts WHERE id=$1`, id).Scan(&stored)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fail(503, "ack_state_unavailable")
	}
	if len(stored) != 32 {
		return false, nil
	}
	return subtle.ConstantTimeCompare(digest(t), stored) == 1, nil
}
func decode(r *http.Request, v any) error {
	media, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaErr != nil || strings.ToLower(media) != "application/json" {
		return fail(415, "json_required")
	}
	if r.ContentLength > bodyLimit {
		return fail(413, "body_too_large")
	}
	b, e := io.ReadAll(io.LimitReader(r.Body, bodyLimit+1))
	if e != nil {
		return fail(400, "request_interrupted")
	}
	if len(b) > bodyLimit {
		return fail(413, "body_too_large")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(b, &fields) != nil || fields == nil {
		return fail(400, "invalid_schema")
	}
	for _, value := range fields {
		if strings.TrimSpace(string(value)) == "null" {
			return fail(400, "invalid_schema")
		}
	}
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil || d.Decode(new(any)) != io.EOF {
		return fail(400, "invalid_schema")
	}
	return nil
}

type input struct {
	ID         *string `json:"alert_id"`
	Title      *string `json:"title"`
	Message    *string `json:"message"`
	TTL        *int    `json:"ttl_seconds"`
	Importance *string `json:"importance"`
}

func (v input) validated() (string, string, string, int, string, error) {
	if v.Title == nil || v.Message == nil || strings.TrimSpace(*v.Title) == "" || strings.TrimSpace(*v.Message) == "" || len([]rune(*v.Title)) > 120 || len([]rune(*v.Message)) > 2000 {
		return "", "", "", 0, "", fail(422, "invalid_message")
	}
	id := ""
	if v.ID != nil {
		id = *v.ID
		if !validID(id) {
			return "", "", "", 0, "", fail(422, "invalid_alert_id")
		}
	}
	ttl := 300
	if v.TTL != nil {
		ttl = *v.TTL
	}
	if ttl < 30 || ttl > 10800 {
		return "", "", "", 0, "", fail(422, "invalid_ttl")
	}
	importance := "critical"
	if v.Importance != nil {
		importance = *v.Importance
	}
	if importance != "critical" && importance != "normal" {
		return "", "", "", 0, "", fail(422, "invalid_importance")
	}
	return id, *v.Title, *v.Message, ttl, importance, nil
}
func (a *API) Handler() (http.Handler, error) {
	if e := a.validate(); e != nil {
		return nil, e
	}
	return http.HandlerFunc(a.serve), nil
}
func (a *API) acquire() bool {
	a.mu.Lock()
	if a.concurrent == nil {
		max := a.MaxConcurrent
		if max <= 0 {
			max = 4
		}
		a.concurrent = make(chan struct{}, max)
	}
	ch := a.concurrent
	a.mu.Unlock()
	select {
	case ch <- struct{}{}:
		return true
	default:
		return false
	}
}
func (a *API) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" && r.URL.Path == "/health" {
		respond(w, 200, map[string]any{"ready": a.Sender != nil, "status": "configuration_only", "delivery_verified": false, "ack_sync_supported": a.AckBase != ""})
		return
	}
	path := r.URL.Path
	if strings.HasPrefix(path, "/v1/dashboard/") || path == "/v1/dashboard" {
		a.serveDashboard(w, r)
		return
	}
	parts := strings.Split(strings.TrimPrefix(path, "/v1/alerts/"), "/")
	id := ""
	ack := false
	if strings.HasPrefix(path, "/v1/alerts/") && len(parts) > 0 && validID(parts[0]) {
		id = parts[0]
		ack = len(parts) == 2 && parts[1] == "ack"
	}
	capRoute := r.Method == "POST" && ack
	ok := false
	if capRoute {
		if a.AckBase != "" {
			var authErr error
			ok, authErr = a.capAuthorized(r.Context(), id, r)
			if authErr != nil {
				failure(w, authErr)
				return
			}
		}
	} else {
		ok = a.appAuthorized(r)
	}
	if !a.allowed(ok) {
		w.Header().Set("Retry-After", "60")
		failure(w, fail(429, "rate_limited"))
		return
	}
	if !ok {
		failure(w, fail(401, "unauthorized"))
		return
	}
	if !a.acquire() {
		w.Header().Set("Retry-After", "1")
		failure(w, fail(429, "rate_limited"))
		return
	}
	defer func() { <-a.concurrent }()
	var e error
	switch {
	case capRoute:
		e = a.ack(w, r, id)
	case r.Method == "POST" && path == "/v1/alerts":
		e = a.create(w, r)
	case r.Method == "GET" && id != "" && len(parts) == 1:
		e = a.get(w, r, id)
	case r.Method == "GET" && path == "/v1/history":
		e = a.history(w, r)
	case r.Method == "GET" && path == "/v1/stats":
		e = a.stats(w, r)
	default:
		e = fail(404, "not_found")
	}
	if e != nil {
		failure(w, e)
	}
}
func (a *API) create(w http.ResponseWriter, r *http.Request) error {
	if a.Sender == nil {
		return fail(503, "fcm_not_configured")
	}
	key := r.Header.Get("Idempotency-Key")
	if !regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`).MatchString(key) {
		return fail(400, "idempotency_key_required")
	}
	var v input
	if e := decode(r, &v); e != nil {
		return e
	}
	id, title, message, ttl, importance, e := v.validated()
	if e != nil {
		return e
	}
	// Keep the legacy critical digest byte-identical, including explicit critical.
	b, _ := json.Marshal(struct {
		ID         string `json:"alert_id"`
		Title      string `json:"title"`
		Message    string `json:"message"`
		TTL        int    `json:"ttl_seconds"`
		Importance string `json:"importance,omitempty"`
	}{id, title, message, ttl, func() string {
		if importance == "normal" {
			return importance
		}
		return ""
	}()})
	bh := digest(string(b))
	if id == "" {
		id = "alt_" + uuid.NewString()
	}
	created := a.now()
	expires := created.Add(time.Duration(ttl) * time.Second)
	// Legacy APKs recognize "alert" as an alarm and ignore importance. A distinct
	// type makes normal fail closed on older clients instead of alarming silently.
	wireType := "alert"
	if importance == "normal" {
		wireType = "notice"
	}
	data := map[string]string{"type": wireType, "alert_id": id, "title": title, "message": message, "expires_at": expires.Format(time.RFC3339Nano), "importance": importance}
	var capHash []byte
	if a.AckBase != "" {
		random := make([]byte, 32)
		if _, e = rand.Read(random); e != nil {
			return fail(503, "temporarily_unavailable")
		}
		token := base64.RawURLEncoding.EncodeToString(random)
		capHash = digest(token)
		data["ack_token"] = token
		data["ack_url"] = a.AckBase + "/v1/alerts/" + id + "/ack"
	}
	// Unique hashes serialize concurrent reservations. Commit before invoking the sender.
	tx, e := a.DB.BeginTx(r.Context(), nil)
	if e != nil {
		return fail(503, "database_unavailable")
	}
	defer tx.Rollback()
	res, e := tx.ExecContext(r.Context(), `INSERT INTO alerts(id,idempotency_hash,body_hash,title,message,created_at,expires_at,capability_hash,importance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`, id, digest(key), bh, title, message, created, expires, capHash, importance)
	if e != nil {
		return fail(503, "database_unavailable")
	}
	n, e := res.RowsAffected()
	if e != nil {
		return fail(503, "database_unavailable")
	}
	if n == 0 {
		var oldID, outcome, oldImportance string
		var stored []byte
		var completed sql.NullTime
		var oldExpires time.Time
		var code sql.NullString
		e = tx.QueryRowContext(r.Context(), `SELECT id,body_hash,outcome,completed_at,expires_at,failure_code,importance FROM alerts WHERE idempotency_hash=$1`, digest(key)).Scan(&oldID, &stored, &outcome, &completed, &oldExpires, &code, &oldImportance)
		if e == sql.ErrNoRows {
			return fail(409, "alert_id_conflict")
		}
		if e != nil {
			return fail(503, "database_unavailable")
		}
		if subtle.ConstantTimeCompare(stored, bh) != 1 || oldImportance != importance {
			return fail(409, "idempotency_conflict")
		}
		if e = tx.Commit(); e != nil {
			return fail(503, "database_unavailable")
		}
		if !completed.Valid {
			return fail(409, "delivery_unknown_or_in_progress")
		}
		w.Header().Set("Idempotency-Replayed", "true")
		sendResult(w, oldID, outcome, oldExpires.UTC(), code.String, oldImportance)
		return nil
	}
	// Only new sends use this newly generated payload. A replay must return its
	// persisted receipt even if timestamp formatting or ACK URL length changed.
	// An oversized new reservation is rolled back; no provider I/O can occur.
	encoded, _ := json.Marshal(data)
	if len(encoded) > payloadLimit {
		return fail(422, "payload_too_large")
	}
	if e = tx.Commit(); e != nil {
		return fail(503, "database_unavailable")
	}
	// Reservation and hashed capability are committed before any network call. Unfinished sends remain unknown across restarts.
	remaining := int(expires.Sub(a.now()).Seconds())
	outcome := "provider_accepted"
	code := ""
	if remaining <= 0 {
		outcome = "provider_failed"
		code = "expired_before_send"
	} else if e = a.Sender.Send(r.Context(), data, remaining); e != nil {
		var se *SendError
		if errors.As(e, &se) && !se.Ambiguous {
			outcome = "provider_failed"
			code = se.Code
		} else {
			outcome = "delivery_unknown"
			code = "provider_delivery_unknown"
		}
	}
	completed := a.now()
	var accepted any
	if outcome == "provider_accepted" {
		accepted = &completed
	}
	// Persist the outcome even if the HTTP client disconnects after the provider responds.
	writeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, e = a.DB.ExecContext(writeCtx, `UPDATE alerts SET outcome=$2,completed_at=$3,provider_accepted_at=$4,failure_code=$5 WHERE id=$1 AND completed_at IS NULL`, id, outcome, completed, accepted, nullable(code))
	if e != nil {
		return fail(503, "delivery_state_unavailable")
	}
	sendResult(w, id, outcome, expires, code, importance)
	return nil
}
func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}
func sendResult(w http.ResponseWriter, id, outcome string, expires time.Time, code, importance string) {
	if outcome == "provider_accepted" {
		respond(w, 202, map[string]any{"alert_id": id, "status": outcome, "expires_at": expires, "acknowledged": false, "delivery_verified": false, "importance": importance})
		return
	}
	if code == "" {
		code = "provider_delivery_unknown"
	}
	respond(w, 502, map[string]any{"alert_id": id, "status": outcome, "error": map[string]string{"code": code}, "delivery_verified": false, "importance": importance})
}
func (a *API) get(w http.ResponseWriter, r *http.Request, id string) error {
	v, acts, e := receipt(r.Context(), a.DB, id)
	if errors.Is(e, sql.ErrNoRows) {
		return fail(404, "not_found")
	}
	if e != nil {
		return fail(503, "database_unavailable")
	}
	respond(w, 200, struct {
		Alert
		Acknowledged     bool     `json:"acknowledged"`
		AckActions       []Action `json:"ack_actions"`
		DeliveryVerified bool     `json:"delivery_verified"`
	}{v, v.AckCount > 0, acts, false})
	return nil
}

type ackInput struct {
	ClientAckedAt  *string `json:"client_acked_at"`
	ClientActionID *string `json:"client_action_id"`
}

func (a *API) ack(w http.ResponseWriter, r *http.Request, id string) error {
	var v ackInput
	if e := decode(r, &v); e != nil {
		return e
	}
	action := legacyID(id)
	if v.ClientActionID != nil {
		u, e := uuid.Parse(*v.ClientActionID)
		if e != nil || u.String() != strings.ToLower(*v.ClientActionID) {
			return fail(422, "invalid_client_action_id")
		}
		action = u.String()
	}
	var client any
	if v.ClientAckedAt != nil {
		t, e := time.Parse(time.RFC3339Nano, *v.ClientAckedAt)
		if e != nil || !strings.Contains(*v.ClientAckedAt, "T") {
			return fail(422, "invalid_client_acked_at")
		}
		client = t
	}
	tx, e := a.DB.BeginTx(r.Context(), nil)
	if e != nil {
		return fail(503, "ack_state_unavailable")
	}
	defer tx.Rollback()
	var locked string
	if e = tx.QueryRowContext(r.Context(), `SELECT id FROM alerts WHERE id=$1 FOR UPDATE`, id).Scan(&locked); e != nil {
		return fail(503, "ack_state_unavailable")
	}
	received := a.now()
	res, e := tx.ExecContext(r.Context(), `INSERT INTO ack_actions(alert_id,client_action_id,client_acked_at,received_at) VALUES($1,$2,$3,$4) ON CONFLICT (alert_id,client_action_id) DO NOTHING`, id, action, client, received)
	if e != nil {
		return fail(503, "ack_state_unavailable")
	}
	inserted, e := res.RowsAffected()
	if e != nil {
		return fail(503, "ack_state_unavailable")
	}
	if inserted == 1 {
		if _, e = tx.ExecContext(r.Context(), `UPDATE alerts SET first_ack_at=COALESCE(first_ack_at,$2) WHERE id=$1`, id, received); e != nil {
			return fail(503, "ack_state_unavailable")
		}
	}
	if e = tx.Commit(); e != nil {
		return fail(503, "ack_state_unavailable")
	}
	vv, _, e := receipt(r.Context(), a.DB, id)
	if e != nil {
		return fail(503, "ack_state_unavailable")
	}
	respond(w, 200, map[string]any{"alert_id": id, "status": "acknowledged", "acknowledged_at": vv.AcknowledgedAt, "ack_count": vv.AckCount, "last_ack_at": vv.LastAckAt})
	return nil
}
func dateParam(q url.Values, k string) (*time.Time, error) {
	v := q.Get(k)
	if v == "" {
		return nil, nil
	}
	t, e := time.Parse(time.RFC3339Nano, v)
	if e != nil {
		return nil, fail(400, "invalid_"+k)
	}
	u := t.UTC()
	return &u, nil
}
func bounds(q url.Values) (*time.Time, *time.Time, error) {
	f, e := dateParam(q, "from")
	if e != nil {
		return nil, nil, e
	}
	t, e := dateParam(q, "to")
	if e != nil {
		return nil, nil, e
	}
	if f != nil && t != nil && !f.Before(*t) {
		return nil, nil, fail(400, "invalid_range")
	}
	return f, t, nil
}
func (a *API) history(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	f, t, e := bounds(q)
	if e != nil {
		return e
	}
	status := q.Get("status")
	if status == "" {
		status = "all"
	}
	switch status {
	case "all", "provider_accepted", "provider_failed", "delivery_unknown", "acknowledged", "pending_ack":
	default:
		return fail(400, "invalid_status")
	}
	limit := 25
	if q.Has("limit") {
		limit, e = strconv.Atoi(q.Get("limit"))
		if e != nil || limit < 1 || limit > 100 {
			return fail(400, "invalid_limit")
		}
	}
	items, next, e := history(r.Context(), a.DB, f, t, status, limit, q.Get("cursor"))
	if e == errBadCursor {
		return fail(400, "invalid_cursor")
	}
	if e != nil {
		return fail(503, "database_unavailable")
	}
	respond(w, 200, map[string]any{"items": items, "next_cursor": next})
	return nil
}
func (a *API) stats(w http.ResponseWriter, r *http.Request) error {
	f, t, e := bounds(r.URL.Query())
	if e != nil {
		return e
	}
	v, e := stats(r.Context(), a.DB, f, t)
	if e != nil {
		return fail(503, "database_unavailable")
	}
	respond(w, 200, v)
	return nil
}

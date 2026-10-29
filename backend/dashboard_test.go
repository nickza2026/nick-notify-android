package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func dashCall(t *testing.T, a *API, method, path, token, body, key string) (int, map[string]any, http.Header) {
	t.Helper()
	r := httptest.NewRequest(method, "/v1/dashboard"+path, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+testKey)
	r.Header.Set("X-Dashboard-Session", token)
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	if key != "" {
		r.Header.Set("Idempotency-Key", key)
	}
	w := httptest.NewRecorder()
	a.serve(w, r)
	var v map[string]any
	if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil {
		t.Fatal(e)
	}
	return w.Code, v, w.Header()
}
func dashError(t *testing.T, got int, v map[string]any, want int, code string) {
	t.Helper()
	mustStatus(t, got, want)
	if v["error"].(map[string]any)["code"] != code || v["request_id"] == nil {
		t.Fatalf("unexpected error %v", v)
	}
}

func TestDashboardLoginCannotDrainAlertOrAckBudget(t *testing.T) {
	db := testDB(t)
	if e := BootstrapDashboard(context.Background(), db, "admin", "synthetic bootstrap password for flood regression"); e != nil {
		t.Fatal(e)
	}
	s := &stub{}
	a := testAPI(t, db, s)
	a.RequestsPerMinute = 2 // Exactly one legacy create and one capability Ack.
	for i := 0; i < 70; i++ {
		status, _, _ := dashCall(t, a, "POST", "/login", "", `{"username":"admin","password":"synthetic wrong password"}`, "")
		if status != 401 && status != 429 {
			t.Fatalf("unexpected failed-login status %d", status)
		}
	}
	for i := 0; i < 20; i++ {
		status, _, _ := dashCall(t, a, "GET", "/session", strings.Repeat("A", 43), "", "")
		if status != 401 && status != 429 {
			t.Fatalf("unexpected invalid-session status %d", status)
		}
		status, _, _ = dashCall(t, a, "POST", "/logout", "", "", "")
		if status != 200 && status != 429 {
			t.Fatalf("unexpected repeated-logout status %d", status)
		}
	}
	status, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "isolated-alert-budget", `{"alert_id":"isolated-budget","title":"synthetic","message":"no real FCM"}`)
	mustStatus(t, status, 202)
	status, _, _ = call(t, a, "POST", "/v1/alerts/isolated-budget/ack", s.token(), "", fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString()))
	mustStatus(t, status, 200)
	status, _, _ = call(t, a, "GET", "/v1/stats", testKey, "", "")
	mustStatus(t, status, 429) // Legacy quota remains enforced, not merely enlarged.
}

func TestDashboardAdmissionDoesNotOccupyOperationalSlots(t *testing.T) {
	db := testDB(t)
	bootstrap := "synthetic bootstrap password for isolated slots"
	if e := BootstrapDashboard(context.Background(), db, "admin", bootstrap); e != nil {
		t.Fatal(e)
	}
	a := testAPI(t, db, &stub{})
	a.MaxConcurrent = 1
	if !a.acquire() {
		t.Fatal("expected owned operational slot")
	}
	status, _, _ := dashCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":%q}`, bootstrap), "")
	<-a.concurrent
	mustStatus(t, status, 200)
	if !a.acquireDashboard() || !a.acquireDashboard() {
		t.Fatal("expected two bounded dashboard slots")
	}
	defer func() { <-a.dashboardConcurrent; <-a.dashboardConcurrent }()
	status, _, _ = dashCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":%q}`, bootstrap), "")
	mustStatus(t, status, 429)
	status, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "separate-slot", `{"alert_id":"separate-slot","title":"synthetic","message":"no real FCM"}`)
	mustStatus(t, status, 202)
}

func TestDashboardLifecycleAndUpgrade(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	s := &stub{}
	a := testAPI(t, db, s)
	a.RequestsPerMinute = 1000
	b := testAPI(t, db, s)
	b.RequestsPerMinute = 1000
	now := time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC)
	a.Now = func() time.Time { return now }
	b.Now = a.Now
	bootstrap := "synthetic bootstrap password 1234567890"
	loginBody := fmt.Sprintf(`{"username":"admin","password":%q}`, bootstrap)
	login := func(api *API) string {
		t.Helper()
		c, v, _ := dashCall(t, api, "POST", "/login", "", loginBody, "")
		mustStatus(t, c, 200)
		return v["session_token"].(string)
	}
	// Explicitly simulate an already-applied 001 database with old alert/ACK rows.
	if _, e := db.Exec(`DROP TABLE dashboard_sessions; DROP TABLE dashboard_owner`); e != nil {
		t.Fatal(e)
	}
	body := `{"alert_id":"preserved","title":"test","message":"synthetic"}`
	c, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "preserved-key", body)
	mustStatus(t, c, 202)
	cap := s.token()
	action := fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString())
	c, _, _ = call(t, a, "POST", "/v1/alerts/preserved/ack", cap, "", action)
	mustStatus(t, c, 200)
	for i := 0; i < 2; i++ {
		if e := Migrate(ctx, db); e != nil {
			t.Fatal(e)
		}
	}
	c, v, _ := dashCall(t, a, "POST", "/login", "", loginBody, "")
	dashError(t, c, v, 503, "dashboard_not_configured")
	if e := BootstrapDashboard(ctx, db, "admin", ""); e != nil {
		t.Fatal(e)
	}
	for _, bad := range []struct{ username, password string }{{"bad user", bootstrap}, {"admin", "short"}, {"admin", strings.Repeat("x", 129)}} {
		if e := BootstrapDashboard(ctx, db, bad.username, bad.password); e == nil {
			t.Fatal("accepted invalid bootstrap")
		}
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- BootstrapDashboard(ctx, db, "admin", bootstrap) }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	var original string
	if e := db.QueryRow(`SELECT password_hash FROM dashboard_owner`).Scan(&original); e != nil {
		t.Fatal(e)
	}
	if e := BootstrapDashboard(ctx, db, "changed", "invalid"); e != nil {
		t.Fatal(e)
	}
	if e := Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	var hash string
	db.QueryRow(`SELECT password_hash FROM dashboard_owner`).Scan(&hash)
	if hash != original {
		t.Fatal("startup reset hash")
	}
	c, v, _ = dashCall(t, a, "POST", "/login", "", `{"username":"admin","password":"wrong"}`, "")
	dashError(t, c, v, 401, "invalid_credentials")
	c, v, _ = dashCall(t, a, "POST", "/login", "", `{"username":"unknown","password":"wrong"}`, "")
	dashError(t, c, v, 401, "invalid_credentials")
	c, v, _ = dashCall(t, a, "POST", "/login", "", `{"username":"admin"}`, "")
	dashError(t, c, v, 400, "invalid_schema")
	token := login(a)
	for _, route := range []struct{ method, path string }{{"POST", "/login"}, {"GET", "/session"}, {"POST", "/change-password"}, {"POST", "/logout"}, {"GET", "/history"}, {"GET", "/stats"}, {"GET", "/alerts/preserved"}, {"POST", "/alerts"}} {
		c, v, _ = call(t, a, route.method, "/v1/dashboard"+route.path, "", "", "")
		dashError(t, c, v, 401, "unauthorized")
	}
	if len(token) != 43 {
		t.Fatal("token size")
	}
	c, v, _ = dashCall(t, b, "GET", "/session", token, "", "")
	mustStatus(t, c, 200)
	if _, ok := v["session_token"]; ok {
		t.Fatal("session disclosed token")
	}
	if !v["user"].(map[string]any)["must_change_password"].(bool) {
		t.Fatal("bootstrap session unrestricted")
	}
	for _, route := range []struct{ method, path string }{{"GET", "/history"}, {"GET", "/stats"}, {"GET", "/alerts/preserved"}, {"POST", "/alerts"}} {
		c, v, _ = dashCall(t, a, route.method, route.path, "", "", "")
		dashError(t, c, v, 401, "session_required")
		c, v, _ = dashCall(t, a, route.method, route.path, token, "", "")
		dashError(t, c, v, 403, "password_change_required")
	}
	c, v, _ = dashCall(t, a, "POST", "/change-password", token, `{"current_password":"wrong","new_password":"a sufficiently long replacement"}`, "")
	dashError(t, c, v, 401, "invalid_credentials")
	c, v, _ = dashCall(t, a, "POST", "/change-password", token, fmt.Sprintf(`{"current_password":%q,"new_password":"short"}`, bootstrap), "")
	dashError(t, c, v, 422, "invalid_password")
	c, v, _ = dashCall(t, a, "POST", "/change-password", token, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, bootstrap, bootstrap), "")
	dashError(t, c, v, 422, "password_unchanged")
	other := login(b)
	next := strings.Repeat("ก", 15)
	c, v, _ = dashCall(t, a, "POST", "/change-password", token, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, bootstrap, next), "")
	mustStatus(t, c, 200)
	full := v["session_token"].(string)
	for _, old := range []string{token, other} {
		c, v, _ = dashCall(t, b, "GET", "/session", old, "", "")
		dashError(t, c, v, 401, "session_required")
	}
	c, v, _ = dashCall(t, b, "POST", "/change-password", full, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, next, bootstrap), "")
	dashError(t, c, v, 422, "password_unchanged")
	for _, path := range []string{"/history", "/stats", "/alerts/preserved"} {
		c, _, _ = dashCall(t, b, "GET", path, full, "", "")
		mustStatus(t, c, 200)
	}
	c, v, _ = dashCall(t, a, "POST", "/change-password", full, `{"current_password":"test"}`, "")
	dashError(t, c, v, 400, "invalid_schema")
	for _, importance := range []string{"normal", "critical"} {
		payload := fmt.Sprintf(`{"alert_id":%q,"title":"test","message":"synthetic","importance":%q}`, importance, importance)
		before := s.calls.Load()
		for i := 0; i < 2; i++ {
			c, _, _ = dashCall(t, a, "POST", "/alerts", full, payload, "dashboard-"+importance)
			mustStatus(t, c, 202)
		}
		if s.calls.Load() != before+1 {
			t.Fatal("retry sent twice")
		}
	}
	// Dashboard sessions cannot act as mobile capability, nor as app key.
	c, v, _ = call(t, a, "POST", "/v1/alerts/preserved/ack", full, "", action)
	dashError(t, c, v, 401, "unauthorized")
	c, v, _ = call(t, a, "GET", "/v1/dashboard/session", full, "", "")
	dashError(t, c, v, 401, "unauthorized")
	now = now.Add(25 * time.Hour)
	c, v, _ = dashCall(t, b, "GET", "/session", full, "", "")
	dashError(t, c, v, 401, "session_required")
	loginBody = fmt.Sprintf(`{"username":"admin","password":%q}`, next)
	full = login(b)
	c, _, _ = dashCall(t, a, "POST", "/logout", full, "", "")
	mustStatus(t, c, 200)
	c, v, _ = dashCall(t, b, "GET", "/session", full, "", "")
	dashError(t, c, v, 401, "session_required")
	for _, tok := range []string{"", full, "invalid"} {
		c, _, _ = dashCall(t, a, "POST", "/logout", tok, "", "")
		mustStatus(t, c, 200)
	}
	c, v, _ = dashCall(t, a, "GET", "/missing", "", "", "")
	dashError(t, c, v, 404, "not_found")
	// Late ACK retries still deduplicate original action and preserve first ACK.
	c, v, _ = call(t, a, "POST", "/v1/alerts/preserved/ack", cap, "", action)
	mustStatus(t, c, 200)
	var count int
	db.QueryRow(`SELECT count(*) FROM ack_actions WHERE alert_id='preserved'`).Scan(&count)
	if count != 1 {
		t.Fatal("ACK upgrade/dedup regression")
	}
	// Fixed persisted throttle window is shared and blocked calls do not extend it.
	for i := 0; i < 5; i++ {
		c, v, _ = dashCall(t, a, "POST", "/login", "", `{"username":"admin","password":"wrong"}`, "")
		dashError(t, c, v, 401, "invalid_credentials")
	}
	var start time.Time
	db.QueryRow(`SELECT login_window FROM dashboard_owner`).Scan(&start)
	now = now.Add(20 * time.Second)
	c, v, h := dashCall(t, b, "POST", "/login", "", loginBody, "")
	dashError(t, c, v, 429, "rate_limited")
	if h.Get("Retry-After") == "" {
		t.Fatal("missing retry")
	}
	var after time.Time
	db.QueryRow(`SELECT login_window FROM dashboard_owner`).Scan(&after)
	if !start.Equal(after) {
		t.Fatal("blocked request extended throttle")
	}
	now = now.Add(41 * time.Second)
	full = login(a)
	for i := 0; i < 5; i++ {
		c, v, _ = dashCall(t, b, "POST", "/change-password", full, `{"current_password":"wrong","new_password":"a sufficiently long replacement"}`, "")
		dashError(t, c, v, 401, "invalid_credentials")
	}
	c, v, _ = dashCall(t, a, "POST", "/change-password", full, fmt.Sprintf(`{"current_password":%q,"new_password":"a sufficiently long replacement"}`, next), "")
	dashError(t, c, v, 429, "rate_limited")
	now = now.Add(time.Minute)
	for i := 0; i < 12; i++ {
		login(a)
	}
	db.QueryRow(`SELECT count(*) FROM dashboard_sessions`).Scan(&count)
	if count != 10 {
		t.Fatalf("session cap %d", count)
	}
	var stored []byte
	db.QueryRow(`SELECT token_hash FROM dashboard_sessions LIMIT 1`).Scan(&stored)
	if len(stored) != 32 {
		t.Fatal("session not hashed")
	}
	var n int
	db.QueryRow(`SELECT count(*) FROM alerts WHERE id='preserved'`).Scan(&n)
	if n != 1 {
		t.Fatal("lost historical alert")
	}
}

func TestDashboardPasswordFormat(t *testing.T) {
	start := time.Now()
	hash, e := passwordHash("synthetic password for isolated cost")
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("PBKDF2 SHA256 600000 hash cost: %s", time.Since(start))
	ok, e := passwordMatches("synthetic password for isolated cost", hash)
	if e != nil || !ok {
		t.Fatal("roundtrip", e)
	}
	for _, bad := range []string{"", strings.Replace(hash, "600000", "999999999", 1), hash + "$extra", strings.Replace(hash, "v1", "v2", 1)} {
		if _, e := passwordMatches("test", bad); e == nil {
			t.Fatal("accepted malformed format")
		}
	}
}

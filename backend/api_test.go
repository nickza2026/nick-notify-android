package backend

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

const testKey = "test_api_key_at_least_32_bytes_not_real_123"

type stub struct {
	calls atomic.Int64
	mu    sync.Mutex
	data  map[string]string
	err   error
}

func (s *stub) Send(_ context.Context, v map[string]string, _ int) error {
	s.calls.Add(1)
	s.mu.Lock()
	s.data = v
	s.mu.Unlock()
	return s.err
}
func (s *stub) token() string { s.mu.Lock(); defer s.mu.Unlock(); return s.data["ack_token"] }
func testDB(t *testing.T) *sql.DB {
	t.Helper()
	pg, url, err := StartEmbedded(t.TempDir())
	if err != nil {
		t.Fatalf("isolated embedded PostgreSQL required: %v", err)
	}
	t.Cleanup(func() {
		if err := pg.Stop(); err != nil {
			t.Errorf("stop owned embedded PostgreSQL: %v", err)
		}
	})
	db, err := Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}
func testAPI(t *testing.T, db *sql.DB, s Sender) *API {
	t.Helper()
	a := &API{DB: db, Key: testKey, Sender: s, AckBase: "https://example.test/base"}
	if _, err := a.Handler(); err != nil {
		t.Fatal(err)
	}
	return a
}
func call(t *testing.T, a *API, method, path, token, key, body string) (int, map[string]any, http.Header) {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if key != "" {
		r.Header.Set("Idempotency-Key", key)
	}
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	a.serve(w, r)
	var v map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	return w.Code, v, w.Header()
}
func mustStatus(t *testing.T, got, want int) {
	t.Helper()
	if got != want {
		t.Fatalf("HTTP %d wanted %d", got, want)
	}
}
func TestPostgresCanonicalMicrosecondsAndTransientAckLookup(t *testing.T) {
	db := testDB(t)
	s := &stub{}
	a := testAPI(t, db, s)
	now := time.Date(2026, 10, 19, 12, 0, 0, 123456789, time.UTC)
	a.Now = func() time.Time { return now }
	body := `{"alert_id":"precision","title":"test","message":"synthetic"}`
	code, sent, _ := call(t, a, "POST", "/v1/alerts", testKey, "precision-key", body)
	mustStatus(t, code, 202)
	code, replay, _ := call(t, a, "POST", "/v1/alerts", testKey, "precision-key", body)
	mustStatus(t, code, 202)
	if sent["expires_at"] != replay["expires_at"] {
		t.Fatalf("PostgreSQL precision changed canonical replay expiry: initial=%v replay=%v", sent["expires_at"], replay["expires_at"])
	}
	token := s.token()
	action := fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString())
	code, first, _ := call(t, a, "POST", "/v1/alerts/precision/ack", token, "", action)
	mustStatus(t, code, 200)
	want := now.Truncate(time.Microsecond).Format(time.RFC3339Nano)
	if first["acknowledged_at"] != want {
		t.Fatal("first ACK response must use PostgreSQL microsecond precision")
	}
	code, retry, _ := call(t, a, "POST", "/v1/alerts/precision/ack", token, "", action)
	mustStatus(t, code, 200)
	if retry["acknowledged_at"] != first["acknowledged_at"] || retry["ack_count"] != float64(1) {
		t.Fatal("canonical first ACK changed on retry")
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	code, _, _ = call(t, a, "POST", "/v1/alerts/precision/ack", token, "", action)
	mustStatus(t, code, 503) // unavailable storage is retriable, never a false permanent 401
	code, _, _ = call(t, a, "POST", "/v1/alerts/precision/ack", "malformed", "", `{}`)
	mustStatus(t, code, 401)
}
func TestPostgresReservationReplayAndCrash(t *testing.T) {
	db := testDB(t)
	s := &stub{}
	a := testAPI(t, db, s)
	body := `{"alert_id":"incidentA","title":"Danger","message":"Check sensor","ttl_seconds":30}`
	code, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "keyA", body)
	mustStatus(t, code, 202)
	token := s.token()
	if len(token) != 43 {
		t.Fatal("missing random capability")
	}
	code, pendingDetail, _ := call(t, a, "GET", "/v1/alerts/incidentA", testKey, "", "")
	mustStatus(t, code, 200)
	if actions, ok := pendingDetail["ack_actions"].([]any); !ok || len(actions) != 0 {
		t.Fatal("unacknowledged detail must encode ack_actions as [], never null")
	}
	code, _, h := call(t, a, "POST", "/v1/alerts", testKey, "keyA", body)
	mustStatus(t, code, 202)
	if h.Get("Idempotency-Replayed") != "true" || s.calls.Load() != 1 {
		t.Fatal("replay resent")
	}
	code, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "keyA", strings.Replace(body, "Danger", "Changed", 1))
	mustStatus(t, code, 409)
	code, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "keyB", body)
	mustStatus(t, code, 409)
	var storedKey, storedCap []byte
	if err := db.QueryRow(`SELECT idempotency_hash,capability_hash FROM alerts WHERE id='incidentA'`).Scan(&storedKey, &storedCap); err != nil {
		t.Fatal(err)
	}
	if string(storedKey) == "keyA" || string(storedCap) == token || len(storedKey) != 32 || len(storedCap) != 32 {
		t.Fatal("plaintext secret persisted")
	}
	code, _, _ = call(t, a, "GET", "/v1/alerts/incidentA", token, "", "")
	mustStatus(t, code, 401)
	code, _, _ = call(t, a, "POST", "/v1/alerts/incidentA/ack", testKey, "", `{}`)
	mustStatus(t, code, 401)
	created := time.Now().UTC().Add(-time.Hour)
	_, err := db.Exec(`INSERT INTO alerts(id,idempotency_hash,body_hash,title,message,created_at,expires_at,capability_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, "crash", digest("crash-key"), digest(`{"alert_id":"crash","title":"Crash","message":"synthetic","ttl_seconds":30}`), "Crash", "synthetic", created, created.Add(30*time.Second), digest(strings.Repeat("A", 43)))
	if err != nil {
		t.Fatal(err)
	}
	restart := testAPI(t, db, &stub{})
	code, _, _ = call(t, restart, "POST", "/v1/alerts", testKey, "crash-key", `{"alert_id":"crash","title":"Crash","message":"synthetic","ttl_seconds":30}`)
	mustStatus(t, code, 409)
	code, _, _ = call(t, restart, "POST", "/v1/alerts/crash/ack", strings.Repeat("A", 43), "", `{}`)
	mustStatus(t, code, 200)
}
func TestPostgresEqualTimePagingAndCompletedUnknownReplay(t *testing.T) {
	db := testDB(t)
	s := &stub{}
	a := testAPI(t, db, s)
	now := time.Date(2026, 10, 19, 10, 0, 0, 123456000, time.UTC)
	a.Now = func() time.Time { return now }
	for _, id := range []string{"tie-a", "tie-c", "tie-b"} {
		body := fmt.Sprintf(`{"alert_id":%q,"title":"tie","message":"synthetic"}`, id)
		code, _, _ := call(t, a, "POST", "/v1/alerts", testKey, id, body)
		mustStatus(t, code, 202)
	}
	cursor := ""
	for _, want := range []string{"tie-c", "tie-b", "tie-a"} {
		items, next, err := history(context.Background(), db, nil, nil, "all", 1, cursor)
		if err != nil || len(items) != 1 || items[0].ID != want {
			t.Fatalf("equal-time keyset order mismatch, wanted %s: %v", want, err)
		}
		if next != nil {
			cursor = *next
		} else if want != "tie-a" {
			t.Fatal("missing keyset cursor")
		}
	}
	from := now.Add(-time.Second).Format(time.RFC3339Nano)
	to := now.Add(time.Second).Format(time.RFC3339Nano)
	query := "/v1/history?status=provider_accepted&limit=1&from=" + from + "&to=" + to
	code, page, _ := call(t, a, "GET", query, testKey, "", "")
	mustStatus(t, code, 200)
	if page["items"].([]any)[0].(map[string]any)["alert_id"] != "tie-c" {
		t.Fatal("date-scoped tie ordering", page)
	}
	boundCursor := page["next_cursor"].(string)
	code, page, _ = call(t, a, "GET", query+"&cursor="+boundCursor, testKey, "", "")
	mustStatus(t, code, 200)
	if page["items"].([]any)[0].(map[string]any)["alert_id"] != "tie-b" {
		t.Fatal("date-scoped tie pagination", page)
	}
	for _, wrong := range []string{"/v1/history?status=all&limit=1&from=" + from + "&to=" + to, "/v1/history?status=provider_accepted&limit=1&from=" + from + "&to=" + now.Add(2*time.Second).Format(time.RFC3339Nano)} {
		code, _, _ = call(t, a, "GET", wrong+"&cursor="+boundCursor, testKey, "", "")
		mustStatus(t, code, 400)
	}
	s.err = &SendError{Code: "synthetic_network_failure", Ambiguous: true}
	body := `{"alert_id":"uncertain","title":"unknown","message":"synthetic"}`
	code, first, _ := call(t, a, "POST", "/v1/alerts", testKey, "uncertain", body)
	mustStatus(t, code, 502)
	if first["status"] != "delivery_unknown" {
		t.Fatal("ambiguous send must remain unknown")
	}
	calls := s.calls.Load()
	code, replay, headers := call(t, a, "POST", "/v1/alerts", testKey, "uncertain", body)
	mustStatus(t, code, 502)
	if replay["status"] != "delivery_unknown" || headers.Get("Idempotency-Replayed") != "true" || s.calls.Load() != calls {
		t.Fatal("completed ambiguous outcome was resent or relabelled")
	}
}
func TestPostgresNormalizedAckHistoryExceedsDocumentLimit(t *testing.T) {
	db := testDB(t)
	s := &stub{}
	a := testAPI(t, db, s)
	code, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "capacity",
		`{"alert_id":"capacity","title":"test","message":"synthetic"}`)
	mustStatus(t, code, 202)
	// Normalized rows have no Firestore document-array ceiling. Insert synthetic UUIDs only.
	_, err := db.Exec(`INSERT INTO ack_actions(alert_id,client_action_id,received_at) SELECT 'capacity', md5(i::text)::uuid,now() FROM generate_series(1,4000) i`)
	if err != nil {
		t.Fatal(err)
	}
	code, _, _ = call(t, a, "POST", "/v1/alerts/capacity/ack", s.token(), "",
		fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString()))
	mustStatus(t, code, 200)
	stored, _, err := receipt(context.Background(), db, "capacity")
	if err != nil || stored.AckCount != 4001 {
		t.Fatal("normalized ACK history lost rows", err, stored.AckCount)
	}
}
func TestPostgresAckBatchClockAndScopes(t *testing.T) {
	db := testDB(t)
	s := &stub{err: &SendError{Code: "provider_rejected"}}
	a := testAPI(t, db, s)
	code, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "failed", `{"alert_id":"failed","title":"test","message":"synthetic"}`)
	mustStatus(t, code, 502)
	token := s.token()
	now := time.Now().UTC().Truncate(time.Second)
	a.Now = func() time.Time { return now }
	first, second := uuid.NewString(), uuid.NewString()
	code, v, _ := call(t, a, "POST", "/v1/alerts/failed/ack", token, "", fmt.Sprintf(`{"client_action_id":%q,"client_acked_at":"2020-01-01T07:00:00+07:00"}`, first))
	mustStatus(t, code, 200)
	at := v["acknowledged_at"]
	a.Now = func() time.Time { return now.Add(-time.Hour) }
	code, v, _ = call(t, a, "POST", "/v1/alerts/failed/ack", token, "", fmt.Sprintf(`{"client_action_id":%q}`, second))
	mustStatus(t, code, 200)
	if v["acknowledged_at"] != at || v["ack_count"] != float64(2) {
		t.Fatal("first acknowledgment changed")
	}
	code, v, _ = call(t, a, "POST", "/v1/alerts/failed/ack", token, "", fmt.Sprintf(`{"client_action_id":%q,"client_acked_at":"2024-01-01T00:00:00Z"}`, first))
	mustStatus(t, code, 200)
	if v["ack_count"] != float64(2) {
		t.Fatal("network retry counted")
	}
	code, v, _ = call(t, a, "GET", "/v1/alerts/failed", testKey, "", "")
	mustStatus(t, code, 200)
	if v["status"] != "provider_failed" || v["acknowledged_at"] != at || len(v["ack_actions"].([]any)) != 2 {
		t.Fatal(v)
	}
	for _, field := range []string{"created_at", "expires_at", "acknowledged_at", "last_ack_at"} {
		if !strings.HasSuffix(v[field].(string), "Z") {
			t.Fatal(field)
		}
	}
	for _, filter := range []string{"provider_failed", "acknowledged", "all"} {
		code, v, _ = call(t, a, "GET", "/v1/history?status="+filter, testKey, "", "")
		mustStatus(t, code, 200)
		items := v["items"].([]any)
		if len(items) != 1 || items[0].(map[string]any)["status"] != "provider_failed" {
			t.Fatal(v)
		}
	}
	if err := SeedDemo(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var demoImportance string
	if err := db.QueryRow(`SELECT importance FROM alerts WHERE id='demo_storage' AND outcome='provider_accepted' AND first_ack_at IS NULL`).Scan(&demoImportance); err != nil || demoImportance != "normal" {
		t.Fatal("expected unacknowledged accepted demo_storage normal fixture", err, demoImportance)
	}
	var normalDemos int
	if err := db.QueryRow(`SELECT count(*) FROM alerts WHERE id LIKE 'demo_%' AND importance='normal'`).Scan(&normalDemos); err != nil || normalDemos != 1 {
		t.Fatal("demo must contain exactly one normal alert", err, normalDemos)
	}
	code, v, _ = call(t, a, "GET", "/v1/stats", testKey, "", "")
	mustStatus(t, code, 200)
	if v["total_alerts"] != float64(7) || v["ack_action_count"] != float64(4) || v["pending_ack"] != float64(2) {
		t.Fatal(v)
	}
	code, v, _ = call(t, a, "GET", "/v1/history?limit=2", testKey, "", "")
	mustStatus(t, code, 200)
	seen := map[string]bool{}
	for {
		for _, item := range v["items"].([]any) {
			id := item.(map[string]any)["alert_id"].(string)
			if seen[id] {
				t.Fatal("duplicate page")
			}
			seen[id] = true
		}
		if v["next_cursor"] == nil {
			break
		}
		cursor := v["next_cursor"].(string)
		code, _, _ = call(t, a, "GET", "/v1/history?cursor="+cursor+"&status=pending_ack", testKey, "", "")
		mustStatus(t, code, 400)
		code, v, _ = call(t, a, "GET", "/v1/history?limit=2&cursor="+cursor, testKey, "", "")
		mustStatus(t, code, 200)
	}
	if len(seen) != 7 {
		t.Fatal("missing pages", len(seen))
	}
}
func TestPostgresConcurrentReservationAndAck(t *testing.T) {
	db := testDB(t)
	s := &stub{}
	a := testAPI(t, db, s)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "parallel", `{"title":"a","message":"b"}`)
			if code != 202 && code != 409 && code != 429 {
				t.Errorf("reservation %d", code)
			}
		}()
	}
	wg.Wait()
	if s.calls.Load() != 1 {
		t.Fatal("duplicate provider send", s.calls.Load())
	}
	code, v, _ := call(t, a, "GET", "/v1/history", testKey, "", "")
	mustStatus(t, code, 200)
	id := v["items"].([]any)[0].(map[string]any)["alert_id"].(string)
	token := s.token()
	one, two := uuid.NewString(), uuid.NewString()
	for _, action := range []string{one, one, two, one} {
		wg.Add(1)
		go func(action string) {
			defer wg.Done()
			code, _, _ := call(t, a, "POST", "/v1/alerts/"+id+"/ack", token, "", fmt.Sprintf(`{"client_action_id":%q}`, action))
			if code != 200 {
				t.Errorf("ack %d", code)
			}
		}(action)
	}
	wg.Wait()
	code, v, _ = call(t, a, "GET", "/v1/alerts/"+id, testKey, "", "")
	mustStatus(t, code, 200)
	if v["ack_count"] != float64(2) {
		t.Fatal(v)
	}
}
func TestPostgresBoundaryPayloadReplayUsesPersistedReceipt(t *testing.T) {
	db := testDB(t)
	s := &stub{}
	a := testAPI(t, db, s)
	now := time.Date(2026, 10, 20, 2, 0, 0, 123450000, time.UTC)
	a.Now = func() time.Time { return now }
	id := "size_boundary"
	data := map[string]string{
		"type": "alert", "alert_id": id, "title": "boundary", "message": "",
		"importance": "critical",
		"expires_at": now.Add(300 * time.Second).Format(time.RFC3339Nano),
		"ack_token":  strings.Repeat("A", 43), "ack_url": a.AckBase + "/v1/alerts/" + id + "/ack",
	}
	empty, _ := json.Marshal(data)
	space := payloadLimit - len(empty)
	message := strings.Repeat("界", space/3) + strings.Repeat("a", space%3)
	body, _ := json.Marshal(map[string]any{"alert_id": id, "title": "boundary", "message": message})
	code, first, _ := call(t, a, "POST", "/v1/alerts", testKey, "boundary-key", string(body))
	mustStatus(t, code, 202)
	s.mu.Lock()
	actual, _ := json.Marshal(s.data)
	s.mu.Unlock()
	if len(actual) != payloadLimit {
		t.Fatalf("fixture payload = %d, want %d", len(actual), payloadLimit)
	}
	now = now.Add(6 * time.Microsecond) // .12345Z becomes .123456Z: a regenerated payload is one byte larger.
	code, replay, headers := call(t, a, "POST", "/v1/alerts", testKey, "boundary-key", string(body))
	mustStatus(t, code, 202)
	if replay["expires_at"] != first["expires_at"] || headers.Get("Idempotency-Replayed") != "true" || s.calls.Load() != 1 {
		t.Fatal("boundary replay changed receipt or resent provider")
	}
	// With a new key/ID this larger payload must still fail and leave no reservation.
	code, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "oversize-key", strings.Replace(string(body), id, "size_boundary2", 1))
	mustStatus(t, code, 422)
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM alerts WHERE id=$1`, "size_boundary2").Scan(&count); err != nil || count != 0 || s.calls.Load() != 1 {
		t.Fatal("oversized payload left a reservation or contacted provider")
	}
}
func TestPostgresValidationAndQuotas(t *testing.T) {
	db := testDB(t)
	s := &stub{}
	a := testAPI(t, db, s)
	for _, base := range []string{"http://x.test", "https://x.test/%61", "https://user@x.test", "https://x.test/a/../b"} {
		if _, err := ValidateAckBase(base); err == nil {
			t.Fatal(base)
		}
	}
	for _, body := range []string{`{"title":null,"message":"a"}`, `{"title":"a","message":"b","secret":"c"}`, fmt.Sprintf(`{"title":"a","message":%q}`, strings.Repeat("💥", 1100))} {
		code, _, _ := call(t, a, "POST", "/v1/alerts", testKey, uuid.NewString(), body)
		if code != 400 && code != 422 {
			t.Fatal(code)
		}
	}
	if s.calls.Load() != 0 {
		t.Fatal("invalid payload sent")
	}
	a.InvalidPerMinute = 1
	code, _, _ := call(t, a, "GET", "/v1/stats", "invalid", "", "")
	mustStatus(t, code, 401)
	code, _, _ = call(t, a, "GET", "/v1/stats", "invalid", "", "")
	mustStatus(t, code, 429)
	code, _, _ = call(t, a, "GET", "/v1/stats", testKey, "", "")
	mustStatus(t, code, 200)
}

func TestPostgresDateScopesCapabilityIsolationAndPayloadBudget(t *testing.T) {
	db := testDB(t)
	s := &stub{}
	a := testAPI(t, db, s)
	code, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "first-key", `{"alert_id":"first","title":"first","message":"synthetic","ttl_seconds":30}`)
	mustStatus(t, code, 202)
	firstToken := s.token()
	code, firstDetail, _ := call(t, a, "GET", "/v1/alerts/first", testKey, "", "")
	mustStatus(t, code, 200)
	created, err := time.Parse(time.RFC3339Nano, firstDetail["created_at"].(string))
	if err != nil {
		t.Fatal(err)
	}
	a.Now = func() time.Time { return created.Add(time.Hour) }
	code, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "second-key", `{"alert_id":"second","title":"second","message":"synthetic"}`)
	mustStatus(t, code, 202)
	secondToken := s.token()
	code, _, _ = call(t, a, "POST", "/v1/alerts/second/ack", firstToken, "", `{}`)
	mustStatus(t, code, 401)
	batch := uuid.NewString()
	for _, pair := range []struct{ id, token string }{{"first", firstToken}, {"second", secondToken}} {
		code, _, _ = call(t, a, "POST", "/v1/alerts/"+pair.id+"/ack", pair.token, "", fmt.Sprintf(`{"client_action_id":%q}`, batch))
		mustStatus(t, code, 200)
	}
	from := created.Format(time.RFC3339)
	to := created.Add(time.Hour).Format(time.RFC3339)
	code, v, _ := call(t, a, "GET", "/v1/history?from="+from+"&to="+to+"&status=acknowledged", testKey, "", "")
	mustStatus(t, code, 200)
	if len(v["items"].([]any)) != 1 || v["items"].([]any)[0].(map[string]any)["alert_id"] != "first" {
		t.Fatal("history scope must use created_at and exclusive upper bound", v)
	}
	code, v, _ = call(t, a, "GET", "/v1/stats", testKey, "", "")
	mustStatus(t, code, 200)
	if v["ack_action_count"] != float64(1) || v["acknowledged"] != float64(2) {
		t.Fatal("batched UUID double-counted", v)
	}
	code, v, _ = call(t, a, "GET", "/v1/stats?from="+from+"&to="+to, testKey, "", "")
	mustStatus(t, code, 200)
	if v["total_alerts"] != float64(1) || v["ack_action_count"] != float64(1) {
		t.Fatal("stats scope must use created_at", v)
	}
	before := s.calls.Load()
	code, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "payload-budget", fmt.Sprintf(`{"title":"wide","message":%q}`, strings.Repeat("界", 1300)))
	mustStatus(t, code, 422)
	if s.calls.Load() != before {
		t.Fatal("oversized FCM payload sent")
	}
}

func TestPostgresRequiresExplicitDatabaseURLAndIdempotentMigration(t *testing.T) {
	if _, err := Open(context.Background(), ""); err == nil {
		t.Fatal("accepted implicit production database")
	}
	db := testDB(t)
	// Simulate an existing database created before importance was introduced.
	if _, err := db.Exec(`ALTER TABLE alerts DROP COLUMN importance`); err != nil {
		t.Fatal(err)
	}
	created := time.Now().UTC().Truncate(time.Microsecond)
	_, err := db.Exec(`INSERT INTO alerts(id,idempotency_hash,body_hash,title,message,created_at,expires_at) VALUES('legacy', $1,$2,'test','synthetic',$3,$4)`, digest("legacy-key"), digest("legacy-body"), created, created.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	earlier := created.Add(2 * time.Second)
	_, err = db.Exec(`INSERT INTO ack_actions(alert_id,client_action_id,received_at) VALUES('legacy',$1,$2),('legacy',$3,$4)`, uuid.NewString(), created.Add(3*time.Second), uuid.NewString(), earlier)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := Migrate(context.Background(), db); err != nil {
			t.Fatal(err)
		}
	}
	var importance string
	if err := db.QueryRow(`SELECT importance FROM alerts WHERE id='legacy'`).Scan(&importance); err != nil || importance != "critical" {
		t.Fatal("existing record not defaulted to critical", err, importance)
	}
	if _, err := db.Exec(`UPDATE alerts SET importance='unknown' WHERE id='legacy'`); err == nil {
		t.Fatal("importance constraint accepted unknown mode")
	}
	var first time.Time
	if err := db.QueryRow(`SELECT first_ack_at FROM alerts WHERE id='legacy'`).Scan(&first); err != nil || !first.UTC().Equal(earlier) {
		t.Fatal("idempotent migration failed ACK backfill", err, first)
	}
	// The probe is inside this test's owned embedded instance, never a supplied database.
	var port int
	if err := db.QueryRow(`SELECT inet_server_port()`).Scan(&port); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE DATABASE encoding_probe ENCODING 'SQL_ASCII' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`); err != nil {
		t.Fatal(err)
	}
	probeURL := fmt.Sprintf("postgres://postgres:postgres@127.0.0.1:%d/encoding_probe?sslmode=disable", port)
	rejected, err := Open(context.Background(), probeURL)
	if rejected != nil {
		rejected.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "UTF8") {
		t.Fatal("non-UTF8 database was not rejected safely")
	}
	probe, err := sql.Open("postgres", probeURL)
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Close()
	var table sql.NullString
	if err := probe.QueryRow(`SELECT to_regclass('public.alerts')::text`).Scan(&table); err != nil || table.Valid {
		t.Fatal("encoding rejection must occur before schema migration", err)
	}
}

func TestPostgresImportanceContract(t *testing.T) {
	db := testDB(t)
	s := &stub{}
	a := testAPI(t, db, s)
	base := `{"alert_id":"mode","title":"test","message":"synthetic"}`
	code, first, _ := call(t, a, "POST", "/v1/alerts", testKey, "mode-key", base)
	mustStatus(t, code, 202)
	if first["importance"] != "critical" || s.data["importance"] != "critical" || s.data["type"] != "alert" {
		t.Fatal("critical default not propagated")
	}
	code, replay, headers := call(t, a, "POST", "/v1/alerts", testKey, "mode-key", `{"alert_id":"mode","title":"test","message":"synthetic","importance":"critical"}`)
	mustStatus(t, code, 202)
	if headers.Get("Idempotency-Replayed") != "true" || replay["importance"] != "critical" || s.calls.Load() != 1 {
		t.Fatal("explicit critical not canonical replay")
	}
	code, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "mode-key", `{"alert_id":"mode","title":"test","message":"synthetic","importance":"normal"}`)
	mustStatus(t, code, 409)
	for _, value := range []string{`null`, `"urgent"`, `5`, `""`} {
		code, _, _ = call(t, a, "POST", "/v1/alerts", testKey, uuid.NewString(), fmt.Sprintf(`{"title":"test","message":"synthetic","importance":%s}`, value))
		if code != 400 && code != 422 {
			t.Fatalf("invalid importance %s accepted: %d", value, code)
		}
	}
	code, normal, _ := call(t, a, "POST", "/v1/alerts", testKey, "normal-key", `{"alert_id":"quiet","title":"test","message":"synthetic","importance":"normal"}`)
	mustStatus(t, code, 202)
	if normal["importance"] != "normal" || s.data["importance"] != "normal" || s.data["type"] != "notice" || s.calls.Load() != 2 {
		t.Fatal("normal delivery data incorrect")
	}
	code, detail, _ := call(t, a, "GET", "/v1/alerts/quiet", testKey, "", "")
	mustStatus(t, code, 200)
	if detail["importance"] != "normal" {
		t.Fatal("detail missing mode")
	}
	code, page, _ := call(t, a, "GET", "/v1/history", testKey, "", "")
	mustStatus(t, code, 200)
	items := page["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["importance"] == nil || items[1].(map[string]any)["importance"] == nil {
		t.Fatal("history missing mode")
	}
}

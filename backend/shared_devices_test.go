package backend

import (
	"bytes"
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

type targetStub struct {
	sync.Mutex
	sent     []targetCall
	failures map[string]error
}
type managedStub struct {
	*targetStub
	legacy      string
	legacyCalls int
}
type staleStub struct {
	*targetStub
	start   chan struct{}
	release chan struct{}
	old     string
}
type opaqueLegacyStub struct{ *targetStub }

func (s *opaqueLegacyStub) HasLegacyTarget() bool { return true }

func (s *staleStub) SendTo(ctx context.Context, token string, data map[string]string, ttl int) error {
	if token == s.old {
		close(s.start)
		<-s.release
		return &SendError{Code: "provider_unregistered"}
	}
	return s.targetStub.SendTo(ctx, token, data, ttl)
}

func (s *managedStub) HasLegacyTarget() bool { return s.legacy != "" }
func (s *managedStub) LegacyToken() string   { return s.legacy }
func (s *managedStub) Send(_ context.Context, _ map[string]string, _ int) error {
	s.Lock()
	defer s.Unlock()
	s.legacyCalls++
	return nil
}

func (s *targetStub) HasLegacyTarget() bool { return false }

type targetCall struct {
	token string
	data  map[string]string
}

func (s *targetStub) Send(context.Context, map[string]string, int) error {
	panic("legacy send when registered devices exist")
}
func (s *targetStub) SendTo(_ context.Context, token string, data map[string]string, _ int) error {
	s.Lock()
	defer s.Unlock()
	s.sent = append(s.sent, targetCall{token, data})
	return s.failures[token]
}
func (s *targetStub) calls() []targetCall {
	s.Lock()
	defer s.Unlock()
	return append([]targetCall{}, s.sent...)
}
func clientCall(t *testing.T, a *API, method, path, token, body string) (int, map[string]any) {
	t.Helper()
	status, v, _ := call(t, a, method, "/v1/client"+path, token, "", body)
	return status, v
}
func ownerClient(t *testing.T, a *API, installation, password string) string {
	t.Helper()
	status, v := clientCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":%q,"installation_id":%q}`, password, installation))
	mustStatus(t, status, 200)
	return v["access_token"].(string)
}
func registerClient(t *testing.T, a *API, access, name, token string) string {
	t.Helper()
	status, v := clientCall(t, a, "POST", "/devices/register", access, fmt.Sprintf(`{"key_id":"primary","device_name":%q,"fcm_token":%q}`, name, token))
	mustStatus(t, status, 200)
	return v["device_id"].(string)
}
func TestSharedDevicesMountedRoutesFanoutAckIsolation(t *testing.T) {
	db := testDB(t)
	bootstrap := "synthetic bootstrap password for shared owner"
	newPass := "synthetic rotated shared owner password"
	if e := BootstrapDashboard(context.Background(), db, "admin", bootstrap); e != nil {
		t.Fatal(e)
	}
	s := &targetStub{failures: map[string]error{}}
	a := testAPI(t, db, s)
	a.RequestsPerMinute = 1000
	installA, installB := uuid.NewString(), uuid.NewString()
	status, v := clientCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":"wrong","installation_id":%q}`, installA))
	dashError(t, status, v, 401, "invalid_credentials")
	access := ownerClient(t, a, installA, bootstrap)
	status, v = clientCall(t, a, "GET", "/keys", access, "")
	dashError(t, status, v, 403, "password_change_required")
	status, v = clientCall(t, a, "POST", "/change-password", access, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, bootstrap, newPass))
	mustStatus(t, status, 200)
	access = v["access_token"].(string)
	status, v = clientCall(t, a, "GET", "/session", access, "")
	mustStatus(t, status, 200)
	if v["access_token"] != nil {
		t.Fatal("session leaked access token")
	}
	status, v = clientCall(t, a, "GET", "/keys", access, "")
	mustStatus(t, status, 200)
	if v["items"].([]any)[0].(map[string]any)["key_id"] != "primary" {
		t.Fatal(v)
	}
	status, v = clientCall(t, a, "POST", "/devices/register", access, `{"key_id":"other","device_name":"A","fcm_token":"abcdefghijklmnopqrstuvwxyz0123456789"}`)
	dashError(t, status, v, 422, "invalid_key_id")
	registerClient(t, a, access, "Phone A", "abcdefghijklmnopqrstuvwxyz0123456789")
	accessB := ownerClient(t, a, installB, newPass)
	deviceB := registerClient(t, a, accessB, "Phone B", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
	registerClient(t, a, access, "Phone A refreshed", "0123456789abcdefghijklmnopqrstuvwxyz")
	status, v = clientCall(t, a, "POST", "/devices/register", accessB, `{"key_id":"primary","device_name":"B","fcm_token":"0123456789abcdefghijklmnopqrstuvwxyz"}`)
	dashError(t, status, v, 409, "fcm_token_conflict")
	status, v = clientCall(t, a, "GET", "/devices", access, "")
	mustStatus(t, status, 200)
	if len(v["items"].([]any)) != 2 {
		t.Fatal(v)
	}
	status, v, _ = call(t, a, "POST", "/v1/alerts", access, "separation", `{"title":"x","message":"x"}`)
	mustStatus(t, status, 401)
	status, v, _ = call(t, a, "POST", "/v1/alerts", testKey, "shared-fanout", `{"alert_id":"shared-fanout","title":"x","message":"x"}`)
	mustStatus(t, status, 202)
	calls := s.calls()
	if len(calls) != 2 {
		t.Fatalf("expected two recipients: %v", calls)
	}
	byToken := map[string]targetCall{}
	for _, c := range calls {
		byToken[c.token] = c
	}
	ca, cb := byToken["0123456789abcdefghijklmnopqrstuvwxyz"], byToken["ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"]
	if ca.data["alert_id"] != "shared-fanout" || cb.data["alert_id"] != "shared-fanout" || ca.data["ack_token"] == cb.data["ack_token"] || len(ca.data["ack_token"]) != 43 {
		t.Fatal("snapshot identity or capability missing")
	}
	action := uuid.NewString()
	ack := fmt.Sprintf(`{"client_action_id":%q}`, action)
	status, _, _ = call(t, a, "POST", "/v1/alerts/shared-fanout/ack", ca.data["ack_token"], "", ack)
	mustStatus(t, status, 200)
	status, _, _ = call(t, a, "POST", "/v1/alerts/shared-fanout/ack", ca.data["ack_token"], "", ack)
	mustStatus(t, status, 200)
	status, v, _ = call(t, a, "GET", "/v1/alerts/shared-fanout", testKey, "", "")
	mustStatus(t, status, 200)
	items := v["deliveries"].([]any)
	if len(items) != 2 || v["ack_count"] != float64(1) {
		t.Fatal(v)
	}
	status, _, _ = call(t, a, "POST", "/v1/alerts/shared-fanout/ack", cb.data["ack_token"], "", ack)
	mustStatus(t, status, 200)
	status, v, _ = call(t, a, "GET", "/v1/alerts/shared-fanout", testKey, "", "")
	mustStatus(t, status, 200)
	if v["ack_count"] != float64(2) {
		t.Fatal(v)
	}
	status, v, _ = call(t, a, "POST", "/v1/alerts", testKey, "shared-fanout", `{"alert_id":"shared-fanout","title":"x","message":"x"}`)
	mustStatus(t, status, 202)
	if len(s.calls()) != 2 {
		t.Fatal("replay fanned out")
	}
	status, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "another-alert", `{"alert_id":"another-alert","title":"x","message":"x"}`)
	mustStatus(t, status, 202)
	for _, c := range s.calls()[2:] {
		if c.token == ca.token {
			status, v, _ = call(t, a, "POST", "/v1/alerts/another-alert/ack", c.data["ack_token"], "", ack)
			mustStatus(t, status, 200)
			status, _, _ = call(t, a, "POST", "/v1/alerts/another-alert/ack", c.data["ack_token"], "", ack)
			mustStatus(t, status, 200)
		}
	}
	status, v, _ = call(t, a, "GET", "/v1/stats", testKey, "", "")
	mustStatus(t, status, 200)
	if v["ack_action_count"] != float64(2) {
		t.Fatal("Ack-all must count once per device across alerts", v)
	}
	var secondCap string
	for _, c := range s.calls()[2:] {
		if c.token == ca.token {
			secondCap = c.data["ack_token"]
		}
	}
	if secondCap == "" {
		t.Fatal("second alert missing original phone")
	}
	concurrentAction := fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString())
	ackResults := make(chan int, 3)
	for _, p := range []struct{ path, cap string }{{"/v1/alerts/shared-fanout/ack", ca.data["ack_token"]}, {"/v1/alerts/another-alert/ack", secondCap}, {"/v1/alerts/another-alert/ack", secondCap}} {
		p := p
		go func() { code, _, _ := call(t, a, "POST", p.path, p.cap, "", concurrentAction); ackResults <- code }()
	}
	for i := 0; i < 3; i++ {
		if code := <-ackResults; code != 200 {
			t.Fatalf("concurrent Ack-all failed: %d", code)
		}
	}
	status, v, _ = call(t, a, "GET", "/v1/stats", testKey, "", "")
	mustStatus(t, status, 200)
	if v["ack_action_count"] != float64(3) {
		t.Fatal("concurrent Ack-all inflated human actions", v)
	}
	status, v = clientCall(t, a, "POST", "/logout", accessB, "")
	mustStatus(t, status, 200)
	if v["logged_out"] != true {
		t.Fatal(v)
	}
	status, v = clientCall(t, a, "GET", "/session", accessB, "")
	dashError(t, status, v, 401, "session_required")
	results := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			code, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "concurrent-shared", `{"alert_id":"concurrent-shared","title":"x","message":"x"}`)
			results <- code
		}()
	}
	for i := 0; i < 2; i++ {
		code := <-results
		if code != 202 && code != 409 {
			t.Fatalf("concurrent receipt: %d", code)
		}
	}
	if len(s.calls()) != 5 {
		t.Fatalf("concurrent reservation sent more than once: %d", len(s.calls()))
	}
	status, v, _ = dashCall(t, a, "GET", "/devices", "", "", "")
	_ = status
	_ = v // dashboard session authorization checked separately below
	_ = deviceB
}

func TestSharedDevicesMixedOutcomesAndRevocation(t *testing.T) {
	db := testDB(t)
	password := "synthetic bootstrap password for mixed delivery"
	if e := BootstrapDashboard(context.Background(), db, "admin", password); e != nil {
		t.Fatal(e)
	}
	s := &targetStub{failures: map[string]error{}}
	a := testAPI(t, db, s)
	a.RequestsPerMinute = 1000
	access := ownerClient(t, a, uuid.NewString(), password)
	status, v := clientCall(t, a, "POST", "/change-password", access, fmt.Sprintf(`{"current_password":%q,"new_password":"synthetic replacement password for mixed"}`, password))
	mustStatus(t, status, 200)
	access = v["access_token"].(string)
	device := registerClient(t, a, access, "Phone", "abcdefghijklmnopqrstuvwxyz0123456789")
	b := ownerClient(t, a, uuid.NewString(), "synthetic replacement password for mixed")
	registerClient(t, a, b, "Other", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
	s.failures["ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] = &SendError{Code: "provider_rejected"}
	status, v, _ = call(t, a, "POST", "/v1/alerts", testKey, "mixed", `{"alert_id":"mixed","title":"x","message":"x","importance":"normal"}`)
	mustStatus(t, status, 502)
	if v["status"] != "delivery_unknown" || v["error"].(map[string]any)["code"] != "partial_provider_outcome" {
		t.Fatal(v)
	}
	status, v, _ = call(t, a, "GET", "/v1/alerts/mixed", testKey, "", "")
	mustStatus(t, status, 200)
	if v["provider_accepted_at"] != nil {
		t.Fatal("aggregate falsely accepted")
	}
	status, v, _ = dashCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":"synthetic replacement password for mixed"}`), "")
	mustStatus(t, status, 200)
	dash := v["session_token"].(string)
	status, v, _ = dashCall(t, a, "GET", "/devices", dash, "", "")
	mustStatus(t, status, 200)
	if len(v["items"].([]any)) != 2 {
		t.Fatal(v)
	}
	status, v, _ = dashCall(t, a, "DELETE", "/devices/"+device, dash, "", "")
	mustStatus(t, status, 200)
	if v["revoked"] != true {
		t.Fatal(v)
	}
	status, v = clientCall(t, a, "GET", "/session", access, "")
	dashError(t, status, v, 401, "session_required")
	status, v, _ = call(t, a, "POST", "/v1/alerts", testKey, "mixed", `{"alert_id":"mixed","title":"x","message":"x","importance":"normal"}`)
	mustStatus(t, status, 502)
	if len(s.calls()) != 2 {
		t.Fatal("replay resent after revocation")
	}
}

func TestSharedDevicesNoStaticTargetAndMigrationRerun(t *testing.T) {
	db := testDB(t)
	password := "synthetic bootstrap password for no static target"
	if e := BootstrapDashboard(context.Background(), db, "admin", password); e != nil {
		t.Fatal(e)
	}
	a := testAPI(t, db, &targetStub{})
	now := time.Now().UTC().Truncate(time.Microsecond)
	a.Now = func() time.Time { return now }
	status, v, _ := call(t, a, "POST", "/v1/alerts", testKey, "no-static", `{"alert_id":"no-static","title":"test","message":"test"}`)
	dashError(t, status, v, 503, "no_devices_registered")
	access := ownerClient(t, a, uuid.NewString(), password)
	status, v = clientCall(t, a, "POST", "/change-password", access, fmt.Sprintf(`{"current_password":%q,"new_password":"synthetic replacement no static target"}`, password))
	mustStatus(t, status, 200)
	access = v["access_token"].(string)
	status, before := clientCall(t, a, "GET", "/session", access, "")
	mustStatus(t, status, 200)
	now = now.Add(12 * time.Hour)
	registerClient(t, a, access, "Only phone", "abcdefghijklmnopqrstuvwxyz0123456789")
	status, after := clientCall(t, a, "GET", "/session", access, "")
	mustStatus(t, status, 200)
	if before["expires_at"] == after["expires_at"] {
		t.Fatal("registration failed to renew native idle expiry")
	}
	var stored []byte
	if e := db.QueryRow(`SELECT token_cipher FROM client_subscriptions`).Scan(&stored); e != nil || bytes.Contains(stored, []byte("abcdefghijklmnopqrstuvwxyz0123456789")) {
		t.Fatal("FCM credential stored in plaintext")
	}
	status, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "no-static", `{"alert_id":"no-static","title":"test","message":"test"}`)
	mustStatus(t, status, 202)
	if e := Migrate(context.Background(), db); e != nil {
		t.Fatalf("rerun migrations: %v", e)
	}
	status, v, _ = call(t, a, "GET", "/v1/alerts/no-static", testKey, "", "")
	mustStatus(t, status, 200)
	if len(v["deliveries"].([]any)) != 1 {
		t.Fatal("migration rerun lost delivery")
	}
}
func TestManagedLegacyImportAdoptionRevocationAndRestart(t *testing.T) {
	db := testDB(t)
	old := "SYNTHETIC_FCM_ORIGINAL_PIXEL_001"
	newToken := "SYNTHETIC_GIRLFRIEND_PHONE_001"
	initial := "synthetic bootstrap password for managed import"
	next := "synthetic replacement password for managed import"
	if e := BootstrapDashboard(context.Background(), db, "admin", initial); e != nil {
		t.Fatal(e)
	}
	s := &managedStub{targetStub: &targetStub{failures: map[string]error{}}, legacy: old}
	a := testAPI(t, db, s)
	a.RequestsPerMinute = 1000
	status, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "before-managed", `{"alert_id":"before-managed","title":"old","message":"old"}`)
	mustStatus(t, status, 202)
	if s.legacyCalls != 1 || len(s.calls()) != 0 {
		t.Fatal("legacy sender was not used before enrollment")
	}
	access := ownerClient(t, a, uuid.NewString(), initial)
	status, v := clientCall(t, a, "POST", "/change-password", access, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, initial, next))
	mustStatus(t, status, 200)
	girlfriend := registerClient(t, a, v["access_token"].(string), "Second phone", newToken)
	status, v, _ = call(t, a, "POST", "/v1/alerts", testKey, "girlfriend-first", `{"alert_id":"girlfriend-first","title":"both","message":"both"}`)
	mustStatus(t, status, 202)
	if s.legacyCalls != 1 || len(s.calls()) != 2 {
		t.Fatal("first enrollment silently dropped configured original phone")
	}
	byToken := map[string]bool{}
	for _, c := range s.calls() {
		byToken[c.token] = true
	}
	if !byToken[old] || !byToken[newToken] {
		t.Fatal("fanout lost one phone", byToken)
	}
	var oldID string
	if e := db.QueryRow(`SELECT id::text FROM client_devices WHERE legacy_import=true`).Scan(&oldID); e != nil {
		t.Fatal(e)
	}
	oldAccess := ownerClient(t, a, uuid.NewString(), next)
	if adopted := registerClient(t, a, oldAccess, "Original phone", old); adopted != oldID {
		t.Fatal("same-token original must adopt existing device ID", adopted, oldID)
	}
	status, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "adopted", `{"alert_id":"adopted","title":"both","message":"both"}`)
	mustStatus(t, status, 202)
	if len(s.calls()) != 4 || s.legacyCalls != 1 {
		t.Fatal("adoption duplicated or reenabled legacy fallback")
	}
	rotated := testAPI(t, db, s)
	rotated.Key = "synthetic_rotated_api_key_longer_than_32_bytes_123"
	status, _, _ = call(t, rotated, "POST", "/v1/alerts", rotated.Key, "rotated-key", `{"alert_id":"rotated-key","title":"both","message":"both"}`)
	mustStatus(t, status, 202)
	if len(s.calls()) != 6 {
		t.Fatal("API key rotation disabled stable-key FCM subscriptions")
	}
	status, v, _ = dashCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":%q}`, next), "")
	mustStatus(t, status, 200)
	dash := v["session_token"].(string)
	for _, id := range []string{oldID, girlfriend} {
		status, _, _ = dashCall(t, a, "DELETE", "/devices/"+id, dash, "", "")
		mustStatus(t, status, 200)
	}
	status, v, _ = call(t, a, "POST", "/v1/alerts", testKey, "after-revoke", `{"alert_id":"after-revoke","title":"none","message":"none"}`)
	dashError(t, status, v, 503, "no_devices_registered")
	if s.legacyCalls != 1 || len(s.calls()) != 6 {
		t.Fatal("revocation resurrected static token")
	}
	if e := Migrate(context.Background(), db); e != nil {
		t.Fatal(e)
	}
	s2 := &managedStub{targetStub: &targetStub{failures: map[string]error{}}, legacy: "SYNTHETIC_NEW_STATIC_TOKEN_DONT_REVIVE"}
	b := testAPI(t, db, s2)
	b.DeviceTokenKey = nil
	status, v, _ = call(t, b, "POST", "/v1/alerts", testKey, "missing-encryption-key", `{"alert_id":"missing-encryption-key","title":"none","message":"none"}`)
	dashError(t, status, v, 503, "device_registration_not_configured")
	b.DeviceTokenKey = []byte("0123456789abcdef0123456789abcdef")
	status, v, _ = call(t, b, "POST", "/v1/alerts", testKey, "after-restart", `{"alert_id":"after-restart","title":"none","message":"none"}`)
	dashError(t, status, v, 503, "no_devices_registered")
	if s2.legacyCalls != 0 {
		t.Fatal("different static token revived managed route")
	}
}
func TestUnregisteredStaleSnapshotDoesNotDeactivateFreshToken(t *testing.T) {
	db := testDB(t)
	initial := "synthetic bootstrap password for stale FCM"
	next := "synthetic replacement password for stale FCM"
	if e := BootstrapDashboard(context.Background(), db, "admin", initial); e != nil {
		t.Fatal(e)
	}
	old := "SYNTHETIC_OLD_FCM_TOKEN_001"
	fresh := "SYNTHETIC_FRESH_FCM_TOKEN_001"
	s := &staleStub{targetStub: &targetStub{failures: map[string]error{}}, old: old, start: make(chan struct{}), release: make(chan struct{})}
	a := testAPI(t, db, s)
	access := ownerClient(t, a, uuid.NewString(), initial)
	status, v := clientCall(t, a, "POST", "/change-password", access, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, initial, next))
	mustStatus(t, status, 200)
	access = v["access_token"].(string)
	id := registerClient(t, a, access, "Phone", old)
	result := make(chan int, 1)
	go func() {
		code, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "stale-unregistered", `{"alert_id":"stale-unregistered","title":"x","message":"x"}`)
		result <- code
	}()
	<-s.start
	if refreshed := registerClient(t, a, access, "Phone updated", fresh); refreshed != id {
		t.Fatal("refresh changed device identity")
	}
	close(s.release)
	if code := <-result; code != 502 {
		t.Fatalf("stale rejected send HTTP %d", code)
	}
	status, v = clientCall(t, a, "GET", "/devices", access, "")
	mustStatus(t, status, 200)
	item := v["items"].([]any)[0].(map[string]any)
	if item["active"] != true {
		t.Fatal("old UNREGISTERED response deactivated refreshed device")
	}
	var hash []byte
	if e := db.QueryRow(`SELECT token_hash FROM client_subscriptions WHERE device_id=$1`, id).Scan(&hash); e != nil || !bytes.Equal(hash, digest(fresh)) {
		t.Fatal("old UNREGISTERED response deleted refreshed token", e)
	}
	status, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "fresh-send", `{"alert_id":"fresh-send","title":"x","message":"x"}`)
	mustStatus(t, status, 202)
	if len(s.calls()) != 1 || s.calls()[0].token != fresh {
		t.Fatal("refreshed subscription did not receive subsequent alert")
	}
}

func TestEnrollmentReadinessPreservesLegacyRoute(t *testing.T) {
	db := testDB(t)
	initial := "synthetic bootstrap password for readiness gate"
	next := "synthetic replacement password for readiness gate"
	if e := BootstrapDashboard(context.Background(), db, "admin", initial); e != nil {
		t.Fatal(e)
	}
	s := &managedStub{targetStub: &targetStub{failures: map[string]error{}}, legacy: "SYNTHETIC_LEGACY_FCM_TOKEN_001"}
	a := testAPI(t, db, s)
	access := ownerClient(t, a, uuid.NewString(), initial)
	status, v := clientCall(t, a, "POST", "/change-password", access, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, initial, next))
	mustStatus(t, status, 200)
	access = v["access_token"].(string)
	registerBody := `{"key_id":"primary","device_name":"new","fcm_token":"SYNTHETIC_NEW_PHONE_TOKEN_001"}`
	a.AckBase = ""
	status, v = clientCall(t, a, "POST", "/devices/register", access, registerBody)
	dashError(t, status, v, 503, "ack_not_configured")
	a.AckBase = "https://example.test/base"
	a.DeviceTokenKey = nil
	status, v = clientCall(t, a, "POST", "/devices/register", access, registerBody)
	dashError(t, status, v, 503, "device_registration_not_configured")
	a.DeviceTokenKey = []byte("0123456789abcdef0123456789abcdef")
	a.Sender = &opaqueLegacyStub{targetStub: &targetStub{failures: map[string]error{}}}
	status, v = clientCall(t, a, "POST", "/devices/register", access, registerBody)
	dashError(t, status, v, 503, "legacy_target_unavailable")
	a.Sender = s
	var managed bool
	var count int
	if e := db.QueryRow(`SELECT managed FROM client_keys`).Scan(&managed); e != nil || managed {
		t.Fatal("failed enrollment changed routing mode", e)
	}
	if e := db.QueryRow(`SELECT count(*) FROM client_devices`).Scan(&count); e != nil || count != 0 {
		t.Fatal("failed enrollment activated device", e, count)
	}
	status, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "readiness-legacy", `{"alert_id":"readiness-legacy","title":"old","message":"old"}`)
	mustStatus(t, status, 202)
	if s.legacyCalls != 1 {
		t.Fatal("readiness failure dropped legacy sender")
	}
}

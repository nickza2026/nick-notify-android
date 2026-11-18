package backend

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

type googleVerifierStub struct {
	identity GoogleIdentity
	err      error
}

func (s *googleVerifierStub) Verify(context.Context, string) (GoogleIdentity, error) {
	return s.identity, s.err
}

func TestGoogleCutoverAndRoutes(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	password := "synthetic bootstrap password with more than 32 characters"
	if e := BootstrapDashboard(ctx, db, "admin", password); e != nil {
		t.Fatal(e)
	}
	a := testAPI(t, db, &stub{})
	c, v, _ := dashCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":%q}`, password), "")
	mustStatus(t, c, 200)
	old := v["session_token"].(string)
	if _, e := db.Exec(`INSERT INTO client_sessions(token_hash,owner_id,installation_id,created_at,expires_at) VALUES($1,1,'11111111-1111-4111-8111-111111111111',now(),now()+interval '1 day')`, digest(strings.Repeat("N", 43))); e != nil {
		t.Fatal(e)
	}
	fake := &googleVerifierStub{identity: GoogleIdentity{UID: "owner-test", Provider: "google.com", Email: "synthetic@example.test", EmailVerified: true}}
	a.AuthMode = "google"
	a.FirebaseProjectID = "synthetic-project"
	a.FirebaseOwnerUID = "owner-test"
	a.GoogleVerifier = fake
	c, v, _ = call(t, a, "GET", "/v1/client/auth-config", "", "", "")
	mustStatus(t, c, 200)
	if len(v) != 2 || v["firebase_project_id"] != "synthetic-project" || v["mode"] != "google" {
		t.Fatalf("unexpected public configuration: %v", v)
	}
	for _, table := range []string{"dashboard_sessions", "client_sessions"} {
		var n int
		if e := db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&n); e != nil || n != 0 {
			t.Fatalf("cutover did not revoke %s: %d %v", table, n, e)
		}
	}
	c, _, _ = dashCall(t, a, "GET", "/session", old, "", "")
	mustStatus(t, c, 401)
	c, v, _ = dashCall(t, a, "POST", "/google-login", "", `{"id_token":"synthetic"}`, "")
	mustStatus(t, c, 200)
	session := v["session_token"].(string)
	if v["user"].(map[string]any)["must_change_password"] != false {
		t.Fatal("Google session restricted")
	}
	if e := a.ActivateGoogleAuth(ctx); e != nil {
		t.Fatal(e)
	}
	c, _, _ = dashCall(t, a, "GET", "/session", session, "", "")
	mustStatus(t, c, 200)
	c, v, _ = call(t, a, "POST", "/v1/client/google-login", "", "", `{"id_token":"synthetic","installation_id":"11111111-1111-4111-8111-111111111111"}`)
	mustStatus(t, c, 200)
	if v["access_token"] == nil {
		t.Fatal("missing native bearer")
	}
	firstNative := v["access_token"].(string)
	c, second := clientCall(t, a, "POST", "/google-login", "", `{"id_token":"synthetic","installation_id":"22222222-2222-4222-8222-222222222222"}`)
	mustStatus(t, c, 200)
	c, _ = clientCall(t, a, "GET", "/keys", firstNative, "")
	mustStatus(t, c, 200)
	c, _ = clientCall(t, a, "POST", "/logout", firstNative, "")
	mustStatus(t, c, 200)
	c, _ = clientCall(t, a, "GET", "/keys", second["access_token"].(string), "")
	mustStatus(t, c, 200)
	a.AuthMode = "password"
	c, _, _ = dashCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":%q}`, password), "")
	mustStatus(t, c, 403)
	c, _, _ = call(t, a, "POST", "/v1/client/login", "", "", fmt.Sprintf(`{"username":"admin","password":%q,"installation_id":"11111111-1111-4111-8111-111111111111"}`, password))
	mustStatus(t, c, 403)
	c, _, _ = dashCall(t, a, "POST", "/change-password", session, fmt.Sprintf(`{"current_password":%q,"new_password":"synthetic replacement password"}`, password), "")
	mustStatus(t, c, 403)
	c, _ = clientCall(t, a, "POST", "/change-password", second["access_token"].(string), fmt.Sprintf(`{"current_password":%q,"new_password":"synthetic replacement password"}`, password))
	mustStatus(t, c, 403)
	a.AuthMode = "google"
	a.FirebaseOwnerUID = "different-owner"
	c, _, _ = call(t, a, "GET", "/v1/client/auth-config", "", "", "")
	mustStatus(t, c, 503)
	c, _, _ = dashCall(t, a, "GET", "/session", session, "", "")
	mustStatus(t, c, 503)
}

func TestGoogleClaimValidation(t *testing.T) {
	db := testDB(t)
	if e := BootstrapDashboard(context.Background(), db, "admin", strings.Repeat("P", 40)); e != nil {
		t.Fatal(e)
	}
	a := testAPI(t, db, &stub{})
	a.AuthMode = "google"
	a.FirebaseProjectID = "synthetic-project"
	a.FirebaseOwnerUID = "owner"
	good := GoogleIdentity{UID: "owner", Provider: "google.com", Email: "synthetic@example.test", EmailVerified: true}
	for _, tc := range []struct {
		name     string
		identity GoogleIdentity
		err      error
		status   int
	}{
		{"wrong UID", GoogleIdentity{UID: "other"}, nil, 403},
		{"wrong provider", GoogleIdentity{UID: "owner", Provider: "password", Email: "x", EmailVerified: true}, nil, 401},
		{"unverified", GoogleIdentity{UID: "owner", Provider: "google.com", Email: "x"}, nil, 401},
		{"missing email", GoogleIdentity{UID: "owner", Provider: "google.com", EmailVerified: true}, nil, 401},
		{"tenant", GoogleIdentity{UID: "owner", Provider: "google.com", Email: "x", EmailVerified: true, Tenant: "tenant"}, nil, 401},
		{"invalid token", good, errors.New("synthetic private claims must not escape"), 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a.GoogleVerifier = &googleVerifierStub{tc.identity, tc.err}
			c, _, _ := dashCall(t, a, "POST", "/google-login", "", `{"id_token":"synthetic"}`, "")
			mustStatus(t, c, tc.status)
		})
	}
	a.GoogleVerifier = &googleVerifierStub{identity: good}
	for _, body := range []string{`null`, `{"id_token":null}`, `{"id_token":""}`, `{"id_token":"synthetic","uid":"owner"}`, `{"id_token":"` + strings.Repeat("x", 8193) + `"}`} {
		c, _, _ := dashCall(t, a, "POST", "/google-login", "", body, "")
		if c < 400 || c >= 500 {
			t.Fatalf("invalid body status %d", c)
		}
	}
}

func TestGoogleMissingOwnerAndInvalidConfiguration(t *testing.T) {
	db := testDB(t)
	a := testAPI(t, db, &stub{})
	a.AuthMode = "google"
	a.FirebaseProjectID = "synthetic-project"
	a.FirebaseOwnerUID = "owner"
	a.GoogleVerifier = &googleVerifierStub{}
	c, _, _ := call(t, a, "GET", "/v1/client/auth-config", "", "", "")
	mustStatus(t, c, 503)
	var n int
	if e := db.QueryRow(`SELECT count(*) FROM dashboard_owner`).Scan(&n); e != nil || n != 0 {
		t.Fatal("created owner", e)
	}
	a.AuthMode = "password"
	c, v, _ := call(t, a, "GET", "/v1/client/auth-config", "", "", "")
	mustStatus(t, c, 200)
	if v["firebase_project_id"] != nil {
		t.Fatal("password config leaked project")
	}
	c, _, _ = call(t, a, "GET", "/v1/dashboard/auth-config", "", "", "")
	mustStatus(t, c, 401)
	c, v, _ = dashCall(t, a, "GET", "/auth-config", "", "", "")
	mustStatus(t, c, 200)
	if len(v) != 2 || v["mode"] != "password" || v["firebase_project_id"] != nil {
		t.Fatal("dashboard configuration differs", v)
	}
	c, _, _ = dashCall(t, a, "POST", "/google-login", "", `{"id_token":"synthetic"}`, "")
	mustStatus(t, c, 403)
	for i := 0; i < 121; i++ {
		c, _, _ = call(t, a, "GET", "/v1/client/auth-config", "", "", "")
	}
	mustStatus(t, c, 429)
	// Authentication admission cannot consume the operational app-key budget.
	c, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "google-budget", `{"alert_id":"google-budget","title":"synthetic","message":"no FCM"}`)
	mustStatus(t, c, 202)
}

func TestGoogleSDKCredentialFreeInitialization(t *testing.T) {
	// Only owned empty directories and a nonexistent canary path are supplied.
	empty := t.TempDir()
	t.Setenv("HOME", empty)
	t.Setenv("USERPROFILE", empty)
	t.Setenv("APPDATA", empty)
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", filepath.Join(empty, "missing-owned-canary.json"))
	t.Setenv("FIREBASE_CONFIG", filepath.Join(empty, "also-missing.json"))
	t.Setenv("FIREBASE_AUTH_EMULATOR_HOST", "")
	t.Setenv("GOOGLE_API_USE_CLIENT_CERTIFICATE", "false")
	t.Setenv("EXPERIMENTAL_GOOGLE_API_USE_S2A", "false")
	v, e := NewGoogleTokenVerifier(context.Background(), "synthetic-project")
	if e != nil {
		t.Fatal(e)
	}
	for _, token := range []string{"malformed", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJvd25lciJ9."} {
		if _, e = v.Verify(context.Background(), token); e == nil {
			t.Fatal("invalid token verified")
		}
	}
	if _, e = os.Stat(filepath.Join(empty, "missing-owned-canary.json")); !os.IsNotExist(e) {
		t.Fatal("canary unexpectedly exists")
	}
	t.Setenv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9999")
	if _, e = NewGoogleTokenVerifier(context.Background(), "synthetic-project"); e == nil {
		t.Fatal("emulator allowed")
	}
	t.Setenv("FIREBASE_AUTH_EMULATOR_HOST", "")
	t.Setenv("GOOGLE_API_USE_CLIENT_CERTIFICATE", "TRUE")
	if _, e = NewGoogleTokenVerifier(context.Background(), "synthetic-project"); e == nil {
		t.Fatal("enterprise credential discovery allowed")
	}
	t.Setenv("GOOGLE_API_USE_CLIENT_CERTIFICATE", "false")
	t.Setenv("EXPERIMENTAL_GOOGLE_API_USE_S2A", "true")
	if _, e = NewGoogleTokenVerifier(context.Background(), "synthetic-project"); e == nil {
		t.Fatal("S2A metadata discovery allowed")
	}
}

func TestGoogleCutoverAtomicPreservation(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	initial := "synthetic original Google preservation bootstrap"
	permanent := "synthetic permanent Google preservation password"
	if e := BootstrapDashboard(ctx, db, "admin", initial); e != nil {
		t.Fatal(e)
	}
	legacy := &stub{}
	a := testAPI(t, db, legacy)
	c, _, _ := call(t, a, "POST", "/v1/alerts", testKey, "google-legacy", `{"alert_id":"google-legacy","title":"synthetic","message":"no FCM"}`)
	mustStatus(t, c, 202)
	c, _, _ = call(t, a, "POST", "/v1/alerts/google-legacy/ack", legacy.token(), "", fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString()))
	mustStatus(t, c, 200)
	sender := &targetStub{failures: map[string]error{}}
	a = testAPI(t, db, sender)
	installation := uuid.NewString()
	access := ownerClient(t, a, installation, initial)
	c, changed := clientCall(t, a, "POST", "/change-password", access, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, initial, permanent))
	mustStatus(t, c, 200)
	access = changed["access_token"].(string)
	registerClient(t, a, access, "synthetic test device", "SYNTHETIC_GOOGLE_TOKEN_NO_REAL_FCM")
	c, web, _ := dashCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":%q}`, permanent), "")
	mustStatus(t, c, 200)
	oldWeb := web["session_token"].(string)
	for _, id := range []string{"google-acked", "google-pending"} {
		c, _, _ = call(t, a, "POST", "/v1/alerts", testKey, id, fmt.Sprintf(`{"alert_id":%q,"title":"synthetic","message":"no FCM"}`, id))
		mustStatus(t, c, 202)
	}
	deliveries := sender.calls()
	c, _, _ = call(t, a, "POST", "/v1/alerts/google-acked/ack", deliveries[0].data["ack_token"], "", fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString()))
	mustStatus(t, c, 200)
	preserved := map[string]string{}
	for _, table := range []string{"alerts", "ack_actions", "client_devices", "client_keys", "client_subscriptions", "device_deliveries", "device_ack_actions"} {
		var count int
		var snapshot string
		if e := db.QueryRow(`SELECT count(*),coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb)::text FROM `+table+` x`).Scan(&count, &snapshot); e != nil || count == 0 {
			t.Fatalf("empty fixture %s: %v", table, e)
		}
		preserved[table] = snapshot
	}
	var hashes string
	if e := db.QueryRow(`SELECT password_hash||bootstrap_hash FROM dashboard_owner`).Scan(&hashes); e != nil {
		t.Fatal(e)
	}
	a.AuthMode = "google"
	a.FirebaseProjectID = "synthetic-project"
	a.FirebaseOwnerUID = "owner"
	a.GoogleVerifier = &googleVerifierStub{identity: GoogleIdentity{UID: "owner", Provider: "google.com", Email: "x", EmailVerified: true}}
	// Deliberate local-only failure on second deletion verifies the entire binding
	// and first deletion roll back together. Pin the connection for pg_temp.
	db.SetMaxOpenConns(1)
	if _, e := db.Exec(`CREATE FUNCTION pg_temp.reject_google_cutover() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER google_cutover_failure BEFORE DELETE ON client_sessions FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.reject_google_cutover()`); e != nil {
		t.Fatal(e)
	}
	if e := a.ActivateGoogleAuth(ctx); e == nil {
		t.Fatal("partial cutover committed")
	}
	var bindings, sessions int
	if e := db.QueryRow(`SELECT (SELECT count(*) FROM owner_google_identity),(SELECT count(*) FROM dashboard_sessions)`).Scan(&bindings, &sessions); e != nil || bindings != 0 || sessions == 0 {
		t.Fatal("cutover was not atomic", e)
	}
	if _, e := db.Exec(`DROP TRIGGER google_cutover_failure ON client_sessions`); e != nil {
		t.Fatal(e)
	}
	if e := a.ActivateGoogleAuth(ctx); e != nil {
		t.Fatal(e)
	}
	for table, want := range preserved {
		var got string
		if e := db.QueryRow(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb)::text FROM ` + table + ` x`).Scan(&got); e != nil || got != want {
			t.Fatalf("cutover changed protected %s: %v", table, e)
		}
	}
	var gotHash string
	if e := db.QueryRow(`SELECT password_hash||bootstrap_hash FROM dashboard_owner`).Scan(&gotHash); e != nil || gotHash != hashes {
		t.Fatal("cutover reset hashes", e)
	}
	c, _, _ = dashCall(t, a, "GET", "/session", oldWeb, "", "")
	mustStatus(t, c, 401)
	c, _ = clientCall(t, a, "GET", "/session", access, "")
	mustStatus(t, c, 401)
	// Operator revocation affects local login sessions only, even when a Google
	// identity and nonempty encrypted device/history/capability data are present.
	c, freshWeb, _ := dashCall(t, a, "POST", "/google-login", "", `{"id_token":"synthetic"}`, "")
	mustStatus(t, c, 200)
	c, freshNative := clientCall(t, a, "POST", "/google-login", "", fmt.Sprintf(`{"id_token":"synthetic","installation_id":%q}`, uuid.NewString()))
	mustStatus(t, c, 200)
	webToken, nativeToken := freshWeb["session_token"].(string), freshNative["access_token"].(string)
	if e := RevokeDashboardOwnerSessions(ctx, db, "not-the-owner"); e == nil {
		t.Fatal("wrong owner confirmation accepted")
	}
	if _, e := db.Exec(`CREATE FUNCTION pg_temp.reject_owner_session_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER owner_session_failure BEFORE DELETE ON client_sessions FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.reject_owner_session_revocation()`); e != nil {
		t.Fatal(e)
	}
	if e := RevokeDashboardOwnerSessions(ctx, db, "admin"); e == nil {
		t.Fatal("partial session revocation committed")
	}
	c, _, _ = dashCall(t, a, "GET", "/session", webToken, "", "")
	mustStatus(t, c, 200)
	c, _ = clientCall(t, a, "GET", "/session", nativeToken, "")
	mustStatus(t, c, 200)
	if _, e := db.Exec(`DROP TRIGGER owner_session_failure ON client_sessions`); e != nil {
		t.Fatal(e)
	}
	if e := RevokeDashboardOwnerSessions(ctx, db, "admin"); e != nil {
		t.Fatal(e)
	}
	c, _, _ = dashCall(t, a, "GET", "/session", webToken, "", "")
	mustStatus(t, c, 401)
	c, _ = clientCall(t, a, "GET", "/session", nativeToken, "")
	mustStatus(t, c, 401)
	for table, want := range preserved {
		var got string
		if e := db.QueryRow(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb)::text FROM ` + table + ` x`).Scan(&got); e != nil || got != want {
			t.Fatalf("session revocation changed protected %s: %v", table, e)
		}
	}
	var boundUID string
	if e := db.QueryRow(`SELECT uid FROM owner_google_identity WHERE owner_id=1`).Scan(&boundUID); e != nil || boundUID != "owner" {
		t.Fatal("session revocation changed identity binding", e)
	}
	// Bad Google configuration cannot stop operational capabilities or routing.
	a.FirebaseOwnerUID = "mismatch"
	c, _, _ = call(t, a, "POST", "/v1/alerts/google-pending/ack", deliveries[1].data["ack_token"], "", fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString()))
	mustStatus(t, c, 200)
	c, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "google-after", `{"alert_id":"google-after","title":"synthetic","message":"no FCM"}`)
	mustStatus(t, c, 202)
	if len(sender.calls()) != 3 || sender.calls()[2].token != "SYNTHETIC_GOOGLE_TOKEN_NO_REAL_FCM" {
		t.Fatal("routing lost encrypted target")
	}
}

func TestGoogleCutoverSerializesPasswordIssuance(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if e := BootstrapDashboard(ctx, db, "admin", strings.Repeat("P", 40)); e != nil {
		t.Fatal(e)
	}
	legacy := testAPI(t, db, &stub{})
	google := testAPI(t, db, &stub{})
	google.AuthMode = "google"
	google.FirebaseProjectID = "synthetic-project"
	google.FirebaseOwnerUID = "owner"
	google.GoogleVerifier = &googleVerifierStub{}
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback()
	if _, e = tx.Exec(`SELECT id FROM dashboard_owner WHERE id=1 FOR UPDATE`); e != nil {
		t.Fatal(e)
	}
	if e = legacy.passwordAuthAllowed(ctx, tx); e != nil {
		t.Fatal(e)
	}
	if _, _, e = newDashboardSession(ctx, tx, time.Now()); e != nil {
		t.Fatal(e)
	}
	limited, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	if e = google.ActivateGoogleAuth(limited); e == nil {
		t.Fatal("cutover bypassed owner lock")
	}
	if e = tx.Commit(); e != nil {
		t.Fatal(e)
	}
	if e = google.ActivateGoogleAuth(ctx); e != nil {
		t.Fatal(e)
	}
	// A legacy process that began before activation still rechecks after locking.
	tx, e = db.BeginTx(ctx, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback()
	if _, e = tx.Exec(`SELECT id FROM dashboard_owner WHERE id=1 FOR UPDATE`); e != nil {
		t.Fatal(e)
	}
	if e = legacy.passwordAuthAllowed(ctx, tx); e == nil {
		t.Fatal("legacy issuance accepted after cutover")
	}
	if e = tx.Rollback(); e != nil {
		t.Fatal(e)
	}
	var n int
	if e = db.QueryRow(`SELECT count(*) FROM dashboard_sessions`).Scan(&n); e != nil || n != 0 {
		t.Fatal("in-flight session survived", e)
	}
}

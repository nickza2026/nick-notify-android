package backend

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestOwnerRecoveryPreservesEnrolledDevicesAndAckCapabilities(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	initial := "synthetic original bootstrap preservation password"
	permanent := "synthetic permanent preservation password"
	temporary := "synthetic temporary preservation password"
	if err := BootstrapDashboard(ctx, db, "admin", initial); err != nil {
		t.Fatal(err)
	}
	// Populate legacy history before managed-device enrollment.
	legacy := &stub{}
	legacyAPI := testAPI(t, db, legacy)
	status, _, _ := call(t, legacyAPI, "POST", "/v1/alerts", testKey, "legacy-recovery", `{"alert_id":"legacy-recovery","title":"synthetic","message":"no FCM"}`)
	mustStatus(t, status, 202)
	status, _, _ = call(t, legacyAPI, "POST", "/v1/alerts/legacy-recovery/ack", legacy.token(), "", fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString()))
	mustStatus(t, status, 200)

	sender := &targetStub{failures: map[string]error{}}
	a := testAPI(t, db, sender)
	a.RequestsPerMinute = 1000
	installation := uuid.NewString()
	access := ownerClient(t, a, installation, initial)
	status, changed := clientCall(t, a, "POST", "/change-password", access, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, initial, permanent))
	mustStatus(t, status, 200)
	access = changed["access_token"].(string)
	registerClient(t, a, access, "เครื่องทดสอบการกู้บัญชี", "SYNTHETIC_RECOVERY_TOKEN_NO_REAL_FCM")
	status, web, _ := dashCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":%q}`, permanent), "")
	mustStatus(t, status, 200)
	oldWeb := web["session_token"].(string)
	for _, id := range []string{"device-acked-recovery", "device-pending-recovery"} {
		status, _, _ = call(t, a, "POST", "/v1/alerts", testKey, id, fmt.Sprintf(`{"alert_id":%q,"title":"synthetic","message":"no FCM"}`, id))
		mustStatus(t, status, 202)
	}
	deliveries := sender.calls()
	if len(deliveries) != 2 {
		t.Fatal("expected two synthetic targeted deliveries")
	}
	status, _, _ = call(t, a, "POST", "/v1/alerts/device-acked-recovery/ack", deliveries[0].data["ack_token"], "", fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString()))
	mustStatus(t, status, 200)
	if _, err := db.Exec(`UPDATE dashboard_owner SET login_failures=4,login_window=now(),change_failures=4,change_window=now()`); err != nil {
		t.Fatal(err)
	}
	var bootstrap string
	if err := db.QueryRow(`SELECT bootstrap_hash FROM dashboard_owner`).Scan(&bootstrap); err != nil {
		t.Fatal(err)
	}
	preserved := map[string]string{}
	for _, table := range []string{"alerts", "ack_actions", "client_devices", "client_keys", "client_subscriptions", "device_deliveries", "device_ack_actions"} {
		var count int
		var snapshot string
		if err := db.QueryRow(`SELECT count(*),coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb)::text FROM `+table+` x`).Scan(&count, &snapshot); err != nil {
			t.Fatal(err)
		}
		if count == 0 {
			t.Fatalf("preservation fixture is empty: %s", table)
		}
		preserved[table] = snapshot
	}
	if err := ResetDashboardOwnerPassword(ctx, db, "admin", temporary); err != nil {
		t.Fatal(err)
	}
	for table, expected := range preserved {
		var actual string
		if err := db.QueryRow(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb)::text FROM ` + table + ` x`).Scan(&actual); err != nil || actual != expected {
			t.Fatalf("reset changed populated protected data: %s", table)
		}
	}
	var originalHash string
	var restricted, throttlesCleared bool
	if err := db.QueryRow(`SELECT bootstrap_hash,must_change_password,login_failures=0 AND login_window IS NULL AND change_failures=0 AND change_window IS NULL FROM dashboard_owner`).Scan(&originalHash, &restricted, &throttlesCleared); err != nil || bootstrap != originalHash || !restricted || !throttlesCleared {
		t.Fatal("reset changed bootstrap blacklist or failed to reset restriction/throttles")
	}
	status, _, _ = dashCall(t, a, "GET", "/session", oldWeb, "", "")
	mustStatus(t, status, 401)
	status, _ = clientCall(t, a, "GET", "/session", access, "")
	mustStatus(t, status, 401)
	// Ack capabilities and managed delivery do not rely on login sessions.
	status, _, _ = call(t, a, "POST", "/v1/alerts/device-pending-recovery/ack", deliveries[1].data["ack_token"], "", fmt.Sprintf(`{"client_action_id":%q}`, uuid.NewString()))
	mustStatus(t, status, 200)
	status, _, _ = call(t, a, "POST", "/v1/alerts", testKey, "after-recovery", `{"alert_id":"after-recovery","title":"synthetic","message":"no FCM"}`)
	mustStatus(t, status, 202)
	if len(sender.calls()) != 3 || sender.calls()[2].token != "SYNTHETIC_RECOVERY_TOKEN_NO_REAL_FCM" {
		t.Fatal("reset deactivated enrollment or changed encrypted target")
	}
	tempAccess := ownerClient(t, a, installation, temporary)
	status, _ = clientCall(t, a, "GET", "/keys", tempAccess, "")
	mustStatus(t, status, 403)
	for _, invalid := range []string{temporary, initial} {
		status, _ = clientCall(t, a, "POST", "/change-password", tempAccess, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, temporary, invalid))
		mustStatus(t, status, 422)
	}
	status, changed = clientCall(t, a, "POST", "/change-password", tempAccess, fmt.Sprintf(`{"current_password":%q,"new_password":"synthetic final recovered password"}`, temporary))
	mustStatus(t, status, 200)
	status, _ = clientCall(t, a, "GET", "/keys", changed["access_token"].(string), "")
	mustStatus(t, status, 200)
}

func TestOwnerRecoveryContendedRowDeadlineRollsBack(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if err := BootstrapDashboard(ctx, db, "admin", "synthetic bootstrap contended recovery password"); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT id FROM dashboard_owner WHERE id=1 FOR UPDATE`); err != nil {
		t.Fatal(err)
	}
	// Bound a broken cancellation implementation without hanging the suite.
	watchdog := time.AfterFunc(3*time.Second, func() { _ = tx.Rollback() })
	defer watchdog.Stop()
	limited, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
	defer cancel()
	started := time.Now()
	if err = ResetDashboardOwnerPassword(limited, db, "admin", "synthetic temporary contended recovery password"); err == nil {
		t.Fatal("reset ignored contended-row cancellation")
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("reset did not respect caller deadline")
	}
	_ = tx.Rollback()
	var same bool
	if err = db.QueryRow(`SELECT password_hash=bootstrap_hash AND must_change_password FROM dashboard_owner`).Scan(&same); err != nil || !same {
		t.Fatal("cancelled reset changed owner")
	}
}

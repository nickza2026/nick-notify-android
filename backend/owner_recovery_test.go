package backend

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestOwnerRecoveryLifecycle(t *testing.T) {
	db := testDB(t)
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	temp := "synthetic temporary recovery password 123456789"
	original := "synthetic original bootstrap password 123456789"
	if _, e := ShowDashboardOwner(ctx, db); e == nil {
		t.Fatal("missing owner accepted")
	}
	if e := ResetDashboardOwnerPassword(ctx, db, "admin", temp); e == nil {
		t.Fatal("created missing owner")
	}
	if e := BootstrapDashboard(ctx, db, "admin", original); e != nil {
		t.Fatal(e)
	}
	a := testAPI(t, db, &stub{})
	a.RequestsPerMinute = 1000
	login := func(password string) (int, map[string]any) {
		c, v, _ := dashCall(t, a, "POST", "/login", "", fmt.Sprintf(`{"username":"admin","password":%q}`, password), "")
		return c, v
	}
	c, v := login(original)
	mustStatus(t, c, 200)
	old := v["session_token"].(string)
	if _, e := db.Exec(`INSERT INTO client_sessions(token_hash,owner_id,installation_id,created_at,expires_at) VALUES($1,1,'11111111-1111-4111-8111-111111111111',now(),now()+interval '1 hour')`, digest(strings.Repeat("N", 43))); e != nil {
		t.Fatal(e)
	}
	preserved := map[string]string{}
	for _, table := range []string{"alerts", "ack_actions", "client_devices", "client_keys", "client_subscriptions", "device_deliveries", "device_ack_actions"} {
		var snapshot string
		if e := db.QueryRow(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)::text FROM ` + table + ` x`).Scan(&snapshot); e != nil {
			t.Fatal(e)
		}
		preserved[table] = snapshot
	}
	var before string
	if e := db.QueryRow(`SELECT row_to_json(o)::text FROM dashboard_owner o`).Scan(&before); e != nil {
		t.Fatal(e)
	}
	status, e := ShowDashboardOwner(ctx, db)
	if e != nil || status.Username != "admin" || !status.MustChangePassword {
		t.Fatal("show failed")
	}
	for _, tc := range []struct{ user, pw string }{{"wrong", temp}, {"admin", original}, {"admin", "short"}, {"admin", strings.Repeat("x", 129)}, {"admin", strings.Repeat("x", 32) + "\xff"}} {
		if e := ResetDashboardOwnerPassword(ctx, db, tc.user, tc.pw); e == nil {
			t.Fatal("invalid reset accepted")
		}
	}
	var after string
	db.QueryRow(`SELECT row_to_json(o)::text FROM dashboard_owner o`).Scan(&after)
	if before != after {
		t.Fatal("rejected operation wrote owner")
	}
	// Force failure on the SECOND deletion, after owner update and web revocation.
	if _, e := db.Exec(`CREATE FUNCTION pg_temp.reject_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER recovery_failure BEFORE DELETE ON client_sessions FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.reject_recovery()`); e != nil {
		t.Fatal(e)
	}
	if e := ResetDashboardOwnerPassword(ctx, db, "admin", temp); e == nil {
		t.Fatal("forced failure committed")
	}
	db.QueryRow(`SELECT row_to_json(o)::text FROM dashboard_owner o`).Scan(&after)
	if before != after {
		t.Fatal("owner rollback failed")
	}
	c, _, _ = dashCall(t, a, "GET", "/session", old, "", "")
	mustStatus(t, c, 200)
	if _, e := db.Exec(`DROP TRIGGER recovery_failure ON client_sessions`); e != nil {
		t.Fatal(e)
	}
	if e := ResetDashboardOwnerPassword(ctx, db, "admin", temp); e != nil {
		t.Fatal(e)
	}
	var remaining int
	db.QueryRow(`SELECT count(*) FROM client_sessions`).Scan(&remaining)
	if remaining != 0 {
		t.Fatal("native sessions retained")
	}
	for table, want := range preserved {
		var got string
		if e := db.QueryRow(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)::text FROM ` + table + ` x`).Scan(&got); e != nil || got != want {
			t.Fatalf("protected table changed: %s", table)
		}
	}
	c, _, _ = dashCall(t, a, "GET", "/session", old, "", "")
	mustStatus(t, c, 401)
	c, _ = login(original)
	mustStatus(t, c, 401)
	c, v = login(temp)
	mustStatus(t, c, 200)
	token := v["session_token"].(string)
	c, _, _ = dashCall(t, a, "GET", "/history", token, "", "")
	mustStatus(t, c, 403)
	if e := ResetDashboardOwnerPassword(ctx, db, "admin", temp); e == nil {
		t.Fatal("current temporary reused")
	}
	for _, pw := range []string{temp, original} {
		c, _, _ = dashCall(t, a, "POST", "/change-password", token, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, temp, pw), "")
		mustStatus(t, c, 422)
	}
	c, _, _ = dashCall(t, a, "POST", "/change-password", token, fmt.Sprintf(`{"current_password":%q,"new_password":"synthetic permanent replacement password"}`, temp), "")
	mustStatus(t, c, 200)
	c, v = login("synthetic permanent replacement password")
	mustStatus(t, c, 200)
	c, _, _ = dashCall(t, a, "GET", "/history", v["session_token"].(string), "", "")
	mustStatus(t, c, 200)
	if e := ResetDashboardOwnerPassword(ctx, db, "admin", original); e == nil {
		t.Fatal("original bootstrap reused")
	}
}

func TestOwnerRecoveryMissingSchemaAndCancellation(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if _, e := db.Exec(`DROP TABLE dashboard_sessions`); e != nil {
		t.Fatal(e)
	}
	if e := BootstrapDashboard(ctx, db, "admin", "synthetic bootstrap password for missing schema"); e != nil {
		t.Fatal(e)
	}
	if e := ResetDashboardOwnerPassword(ctx, db, "admin", "synthetic temporary password missing schema"); e == nil {
		t.Fatal("missing schema accepted")
	}
	var exists bool
	if e := db.QueryRow(`SELECT to_regclass('dashboard_sessions') IS NOT NULL`).Scan(&exists); e != nil || exists {
		t.Fatal("unexpected DDL")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if e := ResetDashboardOwnerPassword(cancelled, db, "admin", "synthetic temporary password cancelled"); e == nil {
		t.Fatal("cancelled reset accepted")
	}
}

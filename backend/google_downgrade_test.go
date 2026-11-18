package backend

import (
	"context"
	"strings"
	"testing"
)

func TestGoogleConfigRejectsBoundDowngrade(t *testing.T) {
	db := testDB(t)
	if err := BootstrapDashboard(context.Background(), db, "admin", strings.Repeat("P", 40)); err != nil {
		t.Fatal(err)
	}
	a := testAPI(t, db, &stub{})
	a.AuthMode, a.FirebaseProjectID, a.FirebaseOwnerUID = "google", "synthetic-project", "owner-test"
	a.GoogleVerifier = &googleVerifierStub{}
	if err := a.ActivateGoogleAuth(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"password", ""} {
		a.AuthMode = mode
		nativeStatus, native, _ := call(t, a, "GET", "/v1/client/auth-config", "", "", "")
		webStatus, web, _ := dashCall(t, a, "GET", "/auth-config", "", "", "")
		for name, result := range map[string]struct {
			status int
			body   map[string]any
		}{"native": {nativeStatus, native}, "web": {webStatus, web}} {
			if result.status != 503 || result.body["mode"] == "password" {
				t.Errorf("%s mode=%q advertised downgraded password config: status=%d body=%v", name, mode, result.status, result.body)
			}
		}
	}
}

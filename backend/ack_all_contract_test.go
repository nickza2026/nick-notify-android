package backend

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

// One physical Ack-all tap is reused across all selected alerts on a phone.
// It is not a request to acknowledge an alert that belongs to another phone.
func TestDeviceAckAllActionAcrossAlerts(t *testing.T) {
	db := testDB(t)
	initial := "synthetic bootstrap password for Ack-all regression"
	replacement := "synthetic replacement password for Ack-all regression"
	if err := BootstrapDashboard(context.Background(), db, "admin", initial); err != nil {
		t.Fatal(err)
	}
	sender := &targetStub{failures: map[string]error{}}
	a := testAPI(t, db, sender)
	access := ownerClient(t, a, uuid.NewString(), initial)
	status, changed := clientCall(t, a, "POST", "/change-password", access, fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, initial, replacement))
	mustStatus(t, status, 200)
	registerClient(t, a, changed["access_token"].(string), "Synthetic phone", "SYNTHETIC_ACK_ALL_TOKEN_NO_FCM")
	for _, id := range []string{"ack-all-first", "ack-all-second"} {
		status, _, _ = call(t, a, "POST", "/v1/alerts", testKey, id, fmt.Sprintf(`{"alert_id":%q,"title":"synthetic","message":"no real FCM"}`, id))
		mustStatus(t, status, 202)
	}
	action := uuid.NewString()
	for _, delivery := range sender.calls() {
		for retry := 0; retry < 2; retry++ {
			status, _, _ = call(t, a, "POST", "/v1/alerts/"+delivery.data["alert_id"]+"/ack", delivery.data["ack_token"], "", fmt.Sprintf(`{"client_action_id":%q}`, action))
			if status != 200 {
				t.Fatalf("one Ack-all action must confirm every selected alert, got HTTP %d", status)
			}
		}
	}
	status, result, _ := call(t, a, "GET", "/v1/stats", testKey, "", "")
	mustStatus(t, status, 200)
	if result["ack_action_count"] != float64(1) {
		t.Fatal("two alerts and retries must count as one human action on this phone")
	}
	if result["acknowledged"] != float64(2) {
		t.Fatal("both selected alerts must have acknowledgement reports")
	}
}

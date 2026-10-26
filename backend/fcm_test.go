package backend

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

type fakeRoundTrip func(*http.Request) (*http.Response, error)

func (f fakeRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func fakeFCM(transport fakeRoundTrip) *FCM {
	return &FCM{token: "synthetic_device_token", project: "synthetic-project",
		source: oauth2.StaticTokenSource(&oauth2.Token{AccessToken: "synthetic_access_token"}),
		client: &http.Client{Transport: transport}}
}
func testFCMData(expires time.Time) map[string]string {
	return map[string]string{"type": "alert", "alert_id": "synthetic", "title": "ทดสอบ", "message": "synthetic only", "expires_at": expires.UTC().Format(time.RFC3339Nano), "importance": "critical"}
}
func TestPureFCMPayloadAndRemainingTTL(t *testing.T) {
	called := false
	sender := fakeFCM(func(r *http.Request) (*http.Response, error) {
		called = true
		if r.Method != "POST" || r.URL.String() != "https://fcm.googleapis.com/v1/projects/synthetic-project/messages:send" || r.Header.Get("Authorization") != "Bearer synthetic_access_token" {
			t.Fatal("incorrect FCM route/auth")
		}
		var body struct {
			Message struct {
				Token   string            `json:"token"`
				Data    map[string]string `json:"data"`
				Android struct {
					Priority string `json:"priority"`
					TTL      string `json:"ttl"`
				} `json:"android"`
			} `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		seconds, err := strconv.Atoi(strings.TrimSuffix(body.Message.Android.TTL, "s"))
		if err != nil || seconds <= 0 || seconds > 60 || body.Message.Android.Priority != "HIGH" || body.Message.Token != "synthetic_device_token" || body.Message.Data["alert_id"] != "synthetic" {
			t.Fatal("incorrect data-only payload or TTL")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"name":"projects/synthetic-project/messages/synthetic"}`)), Header: make(http.Header)}, nil
	})
	if err := sender.Send(context.Background(), testFCMData(time.Now().Add(time.Minute)), 300); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("transport not exercised")
	}
}
func TestPureFCMFailuresAreSanitized(t *testing.T) {
	for _, status := range []int{400, 500, 429, 200} {
		sender := fakeFCM(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(`{"private":"must_not_escape"}`)), Header: make(http.Header)}, nil
		})
		err := sender.Send(context.Background(), testFCMData(time.Now().Add(time.Minute)), 60)
		var failure *SendError
		if !errors.As(err, &failure) || strings.Contains(err.Error(), "must_not_escape") || failure.Ambiguous != (status != 400) {
			t.Fatalf("incorrect sanitized error for HTTP %d", status)
		}
	}
}
func TestPureFCMExpiredNeverContactsProvider(t *testing.T) {
	sender := fakeFCM(func(*http.Request) (*http.Response, error) {
		t.Fatal("expired payload reached provider")
		return nil, nil
	})
	var failure *SendError
	err := sender.Send(context.Background(), testFCMData(time.Now().Add(-time.Second)), 60)
	if !errors.As(err, &failure) || failure.Code != "expired_before_send" || failure.Ambiguous {
		t.Fatal("expiry not rejected before provider")
	}
}
func TestPureFCMNormalTransport(t *testing.T) {
	sender := fakeFCM(func(r *http.Request) (*http.Response, error) {
		var body struct {
			Message struct {
				Data    map[string]string `json:"data"`
				Android struct {
					Priority string `json:"priority"`
				} `json:"android"`
			} `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Message.Data["importance"] != "normal" || body.Message.Android.Priority != "NORMAL" {
			t.Fatal("normal mode did not set normal transport")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"name":"synthetic"}`))}, nil
	})
	data := testFCMData(time.Now().Add(time.Minute))
	data["importance"] = "normal"
	if err := sender.Send(context.Background(), data, 60); err != nil {
		t.Fatal(err)
	}
}
func TestPureDecodeRejectsNullAndWrongMediaType(t *testing.T) {
	for _, body := range []string{`null`, `[]`, `{"ttl_seconds":null}`, `{"alert_id":null}`, `{"client_action_id":null}`} {
		r := httptest.NewRequest("POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		var value input
		if decode(r, &value) == nil {
			t.Fatalf("null/nonobject accepted: %s", body)
		}
	}
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "application/jsonp")
	if decode(r, &input{}) == nil {
		t.Fatal("non-JSON media type accepted")
	}
}
func TestPureAckBaseValidation(t *testing.T) {
	for _, value := range []string{"http://api.invalid", "https://user@api.invalid", "https://api.invalid?x=1", "https://api.invalid/base/../api", "https://api.invalid/base%20path"} {
		if _, err := ValidateAckBase(value); err == nil {
			t.Fatal("invalid Ack origin accepted")
		}
	}
	if value, err := ValidateAckBase("https://api.invalid/base/"); err != nil || value != "https://api.invalid/base" {
		t.Fatal("valid base rejected")
	}
}

package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const messagingScope = "https://www.googleapis.com/auth/firebase.messaging"

type FCM struct {
	token   string
	project string
	source  oauth2.TokenSource
	client  *http.Client
}

// NewFCM only reads the explicitly configured service account file. No default credentials fallback.
func NewFCM(credentialsPath, deviceToken string) (*FCM, error) {
	if credentialsPath == "" || deviceToken == "" {
		return nil, errors.New("fcm_not_configured")
	}
	b, e := os.ReadFile(credentialsPath)
	if e != nil {
		return nil, errors.New("invalid_fcm_configuration")
	}
	var meta struct {
		Type    string `json:"type"`
		Project string `json:"project_id"`
	}
	if json.Unmarshal(b, &meta) != nil || meta.Type != "service_account" || !regexp.MustCompile(`^[a-z][a-z0-9-]{4,62}$`).MatchString(meta.Project) {
		return nil, errors.New("invalid_fcm_configuration")
	}
	c, e := google.JWTConfigFromJSON(b, messagingScope)
	if e != nil {
		return nil, errors.New("invalid_fcm_configuration")
	}
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &FCM{token: deviceToken, project: meta.Project, source: c.TokenSource(context.WithValue(context.Background(), oauth2.HTTPClient, client)), client: client}, nil
}
func (s *FCM) Send(ctx context.Context, data map[string]string, ttl int) error {
	t, e := s.source.Token()
	if e != nil {
		return &SendError{Code: "provider_authentication_failed"}
	}
	expires, e := time.Parse(time.RFC3339Nano, data["expires_at"])
	if e != nil {
		return &SendError{Code: "expired_before_send"}
	}
	remaining := int(time.Until(expires).Seconds())
	if remaining < ttl {
		ttl = remaining
	}
	if ttl <= 0 {
		return &SendError{Code: "expired_before_send"}
	}
	priority := "HIGH"
	if data["importance"] == "normal" {
		priority = "NORMAL"
	} else if data["importance"] != "critical" {
		return &SendError{Code: "invalid_importance"}
	}
	b, _ := json.Marshal(map[string]any{"message": map[string]any{"token": s.token, "data": data, "android": map[string]any{"priority": priority, "ttl": fmt.Sprintf("%ds", ttl)}}})
	req, e := http.NewRequestWithContext(ctx, "POST", "https://fcm.googleapis.com/v1/projects/"+s.project+"/messages:send", bytes.NewReader(b))
	if e != nil {
		return &SendError{Code: "provider_delivery_unknown", Ambiguous: true}
	}
	req.Header.Set("Authorization", "Bearer "+t.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, e := s.client.Do(req)
	if e != nil {
		return &SendError{Code: "provider_delivery_unknown", Ambiguous: true}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp.StatusCode >= 500 || resp.StatusCode == http.StatusRequestTimeout || resp.StatusCode == http.StatusTooManyRequests {
			return &SendError{Code: "provider_delivery_unknown", Ambiguous: true}
		}
		return &SendError{Code: "provider_rejected"}
	}
	var body struct {
		Name string `json:"name"`
	}
	raw, e := io.ReadAll(io.LimitReader(resp.Body, 2048))
	if e != nil || json.Unmarshal(raw, &body) != nil || body.Name == "" {
		return &SendError{Code: "provider_delivery_unknown", Ambiguous: true}
	}
	return nil
}

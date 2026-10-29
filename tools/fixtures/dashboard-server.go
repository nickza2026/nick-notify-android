// Local browser-test fixture only. It never reads production DB/provider config.
// Run from backend/go.mod with --root pointing to a newly owned temp directory.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	backend "dev.notifyalarm/backend"
)

type syntheticSender struct {
	mu    sync.Mutex
	items map[string]map[string]string
	calls int
}

func (s *syntheticSender) Send(_ context.Context, data map[string]string, _ int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	copy := make(map[string]string, len(data))
	for k, v := range data {
		copy[k] = v
	}
	s.items[data["alert_id"]] = copy
	return nil // Synthetic acceptance, not FCM or actual device delivery.
}

func secret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("fixture random source unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func run() (runErr error) {
	rootFlag := flag.String("root", "", "new owned notify-dashboard-browser-* temp root")
	flag.Parse()
	root, err := filepath.Abs(*rootFlag)
	if err != nil || *rootFlag == "" || !strings.HasPrefix(filepath.Base(root), "notify-dashboard-browser-") {
		return errors.New("fixture requires an explicitly owned temporary root")
	}
	rel, err := filepath.Rel(os.TempDir(), root)
	info, statErr := os.Lstat(root)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || statErr != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("fixture root must be an existing non-symlink child of the temp directory")
	}
	pgRoot, err := os.MkdirTemp(root, "owned-pg-")
	if err != nil {
		return err
	}
	pg, databaseURL, err := backend.StartEmbedded(pgRoot)
	if err != nil {
		return err
	}
	defer func() {
		if err := pg.Stop(); err != nil {
			if runErr == nil {
				runErr = errors.New("owned fixture PostgreSQL cleanup failed; preserve the owned directory")
			}
		}
	}()
	db, err := backend.Open(context.Background(), databaseURL)
	if err != nil {
		return errors.New("isolated fixture database initialization failed")
	}
	defer db.Close()
	var encoding, version string
	if db.QueryRow(`SHOW server_encoding`).Scan(&encoding) != nil || db.QueryRow(`SHOW server_version`).Scan(&version) != nil {
		return errors.New("cannot inspect owned fixture PostgreSQL")
	}
	password, key, control := secret(), secret(), secret()
	if err := backend.BootstrapDashboard(context.Background(), db, "admin", password); err != nil {
		return errors.New("isolated fixture bootstrap failed")
	}
	sender := &syntheticSender{items: map[string]map[string]string{}}
	api := &backend.API{DB: db, Key: key, Sender: sender, AckBase: "https://api.synthetic.invalid", RequestsPerMinute: 10000, InvalidPerMinute: 10000}
	handler, err := api.Handler()
	if err != nil {
		return err
	}
	var target atomic.Pointer[url.URL]
	proxy := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := target.Load()
		if u == nil {
			http.Error(w, "fixture proxy not ready", http.StatusServiceUnavailable)
			return
		}
		// Default Director preserves incoming Host, as required by the Web's
		// canonical-origin check behind TLS termination. No real ingress used.
		httputil.NewSingleHostReverseProxy(u).ServeHTTP(w, r)
	}))
	defer proxy.Close()
	done := make(chan struct{})
	var stop sync.Once
	var failCursor atomic.Bool
	var cursorCalls atomic.Int64
	var failCreateResponse atomic.Bool
	var createRequests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/__fixture/") {
			if r.Method == "POST" && r.URL.Path == "/v1/dashboard/alerts" {
				createRequests.Add(1)
				if failCreateResponse.Swap(false) {
					rec := httptest.NewRecorder()
					handler.ServeHTTP(rec, r)
					if rec.Code == 202 {
						// Provider already accepted synthetically; client loses its
						// receipt. A retry must replay, never invoke Sender again.
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(503)
						fmt.Fprint(w, `{"error":{"code":"temporarily_unavailable"}}`)
					} else {
						for key, values := range rec.Header() {
							w.Header()[key] = values
						}
						w.WriteHeader(rec.Code)
						_, _ = w.Write(rec.Body.Bytes())
					}
					return
				}
			}
			if r.Method == "GET" && r.URL.Path == "/v1/dashboard/history" && r.URL.Query().Get("cursor") != "" {
				cursorCalls.Add(1)
				if failCursor.Swap(false) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(503)
					fmt.Fprint(w, `{"error":{"code":"temporarily_unavailable"}}`)
					return
				}
			}
			handler.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodPost || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Fixture-Control")), []byte(control)) != 1 {
			http.Error(w, "fixture control denied", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/__fixture/fail-create-response":
			failCreateResponse.Store(true)
			fmt.Fprint(w, `{"ok":true}`)
		case "/__fixture/seed-history":
			// Explicit, synthetic history only; no provider and no fabricated Ack.
			tx, err := db.BeginTx(r.Context(), nil)
			if err != nil {
				w.WriteHeader(503)
				return
			}
			defer tx.Rollback()
			var inserted int64
			for i := 0; i < 26; i++ {
				id := fmt.Sprintf("pagination-fixture-%02d", i)
				hash := sha256.Sum256([]byte(id))
				now := time.Now().UTC().Add(time.Duration(i) * time.Millisecond)
				result, err := tx.ExecContext(r.Context(), `INSERT INTO alerts(id,idempotency_hash,body_hash,title,message,importance,created_at,expires_at) VALUES($1,$2,$2,$3,$4,'normal',$5,$6) ON CONFLICT DO NOTHING`, id, hash[:], "ข้อมูลสังเคราะห์สำหรับ pagination", "ไม่เคยส่ง FCM และไม่สร้าง Ack จำลอง", now, now.Add(time.Hour))
				if err != nil {
					w.WriteHeader(503)
					return
				}
				count, _ := result.RowsAffected()
				inserted += count
			}
			if err := tx.Commit(); err != nil {
				w.WriteHeader(503)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"seeded": inserted})
		case "/__fixture/fail-pagination":
			failCursor.Store(true)
			fmt.Fprint(w, `{"ok":true}`)
		case "/__fixture/proxy":
			var v struct {
				URL string `json:"url"`
			}
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&v) != nil {
				w.WriteHeader(400)
				return
			}
			u, err := url.Parse(v.URL)
			if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
				w.WriteHeader(400)
				return
			}
			target.Store(u)
			fmt.Fprint(w, `{"ok":true}`)
		case "/__fixture/ack":
			var v struct {
				ID       string `json:"alert_id"`
				Action   string `json:"client_action_id"`
				ClientAt string `json:"client_acked_at"`
			}
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&v) != nil {
				w.WriteHeader(400)
				return
			}
			sender.mu.Lock()
			capability := sender.items[v.ID]["ack_token"]
			sender.mu.Unlock()
			if capability == "" {
				w.WriteHeader(404)
				return
			}
			body, _ := json.Marshal(map[string]string{"client_action_id": v.Action, "client_acked_at": v.ClientAt})
			req := httptest.NewRequest("POST", "/v1/alerts/"+url.PathEscape(v.ID)+"/ack", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+capability)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			w.WriteHeader(rec.Code)
			// Ack response contains counts/timestamps, never the capability.
			_, _ = w.Write(rec.Body.Bytes())
		case "/__fixture/inspect":
			sender.mu.Lock()
			items := make(map[string]string, len(sender.items))
			for id, data := range sender.items {
				items[id] = data["importance"]
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"send_calls": sender.calls, "importance": items, "cursor_calls": cursorCalls.Load(), "create_requests": createRequests.Load()})
			sender.mu.Unlock()
		case "/__fixture/stop":
			fmt.Fprint(w, `{"ok":true}`)
			stop.Do(func() { close(done) })
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	manifest := map[string]string{"api_url": server.URL, "web_url": proxy.URL, "api_key": key, "bootstrap_password": password, "control": control, "database_encoding": encoding, "database_version": version}
	b, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(root, "private-fixture.json"), b, 0600); err != nil {
		return err
	}
	fmt.Println("Ready: isolated UTF8 PostgreSQL + synthetic sender + loopback TLS proxy (no FCM)")
	select {
	case <-done:
		return nil
	case <-time.After(20 * time.Minute):
		return errors.New("owned browser fixture timed out")
	}
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

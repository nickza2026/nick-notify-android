package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	backend "dev.notifyalarm/backend"
)

type fake struct{}

func (fake) Send(context.Context, map[string]string, int) error { return nil }
func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func run() error {
	synthetic := flag.Bool("synthetic", false, "required: local-only synthetic fixture and fake provider")
	stopFile := flag.String("stop-file", "", "optional local file whose creation gracefully stops this demo")
	port := flag.Int("port", 8791, "loopback HTTP demo port")
	flag.Parse()
	if !*synthetic {
		return errors.New("local demo requires --synthetic")
	}
	if *port < 1 || *port > 65535 {
		return errors.New("invalid demo port")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if *stopFile != "" {
		if _, err := os.Stat(*stopFile); err == nil || !os.IsNotExist(err) {
			return errors.New("stop-file must not already exist")
		}
		go func() {
			ticker := time.NewTicker(250 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if _, err := os.Stat(*stopFile); err == nil {
						cancel()
						return
					}
				}
			}
		}()
	}
	dir, e := os.MkdirTemp("", "notify-demo-pg-")
	if e != nil {
		return errors.New("cannot create demo runtime")
	}
	defer os.RemoveAll(dir)
	pg, url, e := backend.StartEmbedded(dir)
	if e != nil {
		return errors.New("embedded demo database unavailable")
	}
	defer pg.Stop()
	db, e := backend.Open(ctx, url)
	if e != nil {
		return errors.New("demo database initialization failed")
	}
	defer db.Close()
	key := os.Getenv("ALERT_API_KEY")
	if key == "" {
		key = "synthetic_demo_api_key_not_for_production_0001"
	}
	if e = backend.SeedDemo(ctx, db); e != nil {
		return errors.New("demo fixture initialization failed")
	}
	api := &backend.API{DB: db, Key: key, Sender: fake{}, AckBase: "https://demo.invalid"}
	h, e := api.Handler()
	if e != nil {
		return errors.New("demo API initialization failed (ALERT_API_KEY must be at least 32 bytes)")
	}
	l, e := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(*port)))
	if e != nil {
		return errors.New("demo port unavailable")
	}
	defer l.Close()
	s := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second}
	served := make(chan error, 1)
	go func() { served <- s.Serve(l) }()
	log.Printf("SYNTHETIC DEMO ONLY, no FCM. URL http://127.0.0.1:%d ephemeral runtime=%s", *port, filepath.Base(dir))
	stopping := false
	select {
	case <-ctx.Done():
		stopping = true
	case e = <-served:
	}
	shutdown, done := context.WithTimeout(context.Background(), 10*time.Second)
	shutdownErr := s.Shutdown(shutdown)
	done()
	if stopping {
		e = <-served
	}
	if shutdownErr != nil {
		return errors.New("demo HTTP shutdown failed")
	}
	if e != nil && e != http.ErrServerClosed {
		return errors.New("demo listener stopped")
	}
	return nil
}

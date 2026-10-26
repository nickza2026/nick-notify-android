package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	backend "dev.notifyalarm/backend"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	port := 8791
	if v := os.Getenv("PORT"); v != "" {
		n, e := strconv.Atoi(v)
		if e != nil || n < 1 || n > 65535 {
			return errors.New("invalid PORT")
		}
		port = n
	}
	host := os.Getenv("HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	db, e := backend.Open(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		return errors.New("PostgreSQL startup failed (check DATABASE_URL and migrations; credentials not logged)")
	}
	defer db.Close()
	var sender backend.Sender
	if os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") != "" && os.Getenv("FCM_DEVICE_TOKEN") != "" {
		sender, e = backend.NewFCM(os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"), os.Getenv("FCM_DEVICE_TOKEN"))
		if e != nil {
			return errors.New("invalid FCM configuration")
		}
	}
	api := &backend.API{DB: db, Key: os.Getenv("ALERT_API_KEY"), AckBase: os.Getenv("ACK_PUBLIC_BASE_URL"), Sender: sender}
	h, e := api.Handler()
	if e != nil {
		return errors.New("invalid API configuration")
	}
	l, e := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if e != nil {
		return errors.New("cannot bind HTTP listener")
	}
	defer l.Close()
	s := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 8192}
	served := make(chan error, 1)
	go func() { served <- s.Serve(l) }()
	log.Print("Notify API listening; health is configuration only, not verified device delivery. TLS termination is external.")
	stopping := false
	select {
	case <-ctx.Done():
		stopping = true
	case e = <-served:
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	shutdownErr := s.Shutdown(shutdown)
	cancel()
	if stopping {
		e = <-served
	}
	if shutdownErr != nil {
		return errors.New("HTTP shutdown failed")
	}
	if e != nil && e != http.ErrServerClosed {
		return errors.New("HTTP listener stopped")
	}
	return nil
}

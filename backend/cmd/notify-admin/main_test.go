package main

import (
	"bytes"
	"context"
	backend "dev.notifyalarm/backend"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// This integration case starts its own disposable loopback cluster; it never
// consumes TEST_DB_URL or production/provider configuration.
func TestCommandIntegration(t *testing.T) {
	pg, dsn, e := backend.StartEmbedded(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer pg.Stop()
	db, e := backend.Open(context.Background(), dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = backend.BootstrapDashboard(context.Background(), db, "admin", "synthetic original bootstrap CLI password"); e != nil {
		t.Fatal(e)
	}
	u, e := url.Parse(dsn)
	if e != nil {
		t.Fatal("synthetic URL invalid")
	}
	u.User = url.UserPassword(u.User.Username(), "postgres") // owned embedded cluster default only
	dir := t.TempDir()
	d := filepath.Join(dir, "db")
	p := filepath.Join(dir, "password")
	if e = os.WriteFile(d, []byte(u.String()), 0600); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(p, []byte("synthetic temporary CLI password 123456789"), 0600); e != nil {
		t.Fatal(e)
	}
	var b bytes.Buffer
	if e = run(context.Background(), []string{"owner", "show", "--db-url-file", d}, &b); e != nil {
		t.Fatal(e)
	}
	if b.String() != "username=admin\nmust_change_password=true\n" {
		t.Fatal("unexpected show output")
	}
	b.Reset()
	if e = run(context.Background(), []string{"owner", "reset-password", "--db-url-file", d, "--confirm-username", "admin", "--password-file", p}, &b); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(b.String(), "123456789") {
		t.Fatal("password echoed")
	}
	b.Reset()
	if e = run(context.Background(), []string{"owner", "revoke-sessions", "--db-url-file", d, "--confirm-username", "admin"}, &b); e != nil {
		t.Fatal(e)
	}
	if b.String() != "Owner web/native login sessions revoked; devices and alerts preserved.\n" {
		t.Fatal("unexpected revocation result")
	}
}

func TestPrivateInput(t *testing.T) {
	p := filepath.Join(t.TempDir(), "private")
	for _, tc := range []struct {
		input, want string
		ok          bool
	}{
		{"\xef\xbb\xbf  intentional spaces  \r\n", "  intentional spaces  ", true},
		{"hello\n", "hello", true}, {"hello", "hello", true}, {"\xff", "", false}, {"a\n\n", "", false}, {"", "", false}, {strings.Repeat("x", 40), "", false}, {"a\x00b", "", false},
	} {
		if e := os.WriteFile(p, []byte(tc.input), 0600); e != nil {
			t.Fatal(e)
		}
		b, e := privateInput(p, 32)
		if (e == nil) != tc.ok || tc.ok && string(b) != tc.want {
			t.Fatalf("input validation mismatch: %v", e)
		}
	}
	if _, e := privateInput(t.TempDir(), 32); e == nil {
		t.Fatal("directory accepted")
	}
}

func TestCommandNoAmbientOrEcho(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://secret:secret@external.invalid/live")
	for _, args := range [][]string{{"owner", "show"}, {"owner", "reset-password", "--password", "TOP_SECRET"}, {"TOP_SECRET"}, {"owner", "show", "--TOP_SECRET", "TOP_SECRET"}} {
		var b bytes.Buffer
		e := run(context.Background(), args, &b)
		if e == nil {
			t.Fatal("accepted invalid command")
		}
		if strings.Contains(e.Error()+b.String(), "SECRET") || strings.Contains(e.Error(), "external") {
			t.Fatal("secret echoed")
		}
	}
	var b bytes.Buffer
	if e := run(context.Background(), []string{"--help"}, &b); e != nil || !strings.Contains(b.String(), "--password-file") {
		t.Fatal("help missing")
	}
}

func TestDatabaseURI(t *testing.T) {
	for _, s := range []string{"", "host=private password=SECRET", "postgres:///db", "postgres://u:p@remote/db?sslmode=disable", "postgres://u:p@remote/db", "postgres://u:p@remote/db?sslmode=verify-full&host=elsewhere",
		"postgres://u:@remote/db?sslmode=verify-full", "postgres://u:p@remote/db?sslmode=verify-ca",
		"postgres://u:p@localhost/db?sslmode=disable", "postgres://u:p@remote:0/db?sslmode=verify-full",
		"postgres://u:p@remote/db?sslmode=verify-full&sslmode=disable",
		"postgres://u:p@remote/db?sslmode=verify-full&user=other",
		"postgres://u:p@remote/db?sslmode=verify-full&password=other",
		"postgres://u:p@remote/db?sslmode=verify-full&dbname=other",
		"postgres://u:p@remote/db?sslmode=verify-full&port=9999",
		"postgres://u:p@remote/db?sslmode=verify-full&search_path=other"} {
		if _, e := databaseURI([]byte(s)); e == nil {
			t.Fatal("invalid URI accepted")
		}
	}
	for _, s := range []string{"postgres://u:p@127.0.0.1/db?sslmode=disable", "postgres://u:p@remote/db?sslmode=verify-full"} {
		v, e := databaseURI([]byte(s))
		if e != nil || !strings.Contains(v, "connect_timeout=5") || !strings.Contains(v, ":5432/db") {
			t.Fatal("valid URI rejected")
		}
	}
}

func TestCommandRejectsAmbientPGWithoutEchoOrConnection(t *testing.T) {
	p := filepath.Join(t.TempDir(), "private-db-url")
	if err := os.WriteFile(p, []byte("postgres://synthetic:synthetic@127.0.0.1:1/no_server?sslmode=disable"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"PGPASSWORD", "PGPORT", "PGSERVICE", "PGSSLROOTCERT", "PGOPTIONS"} {
		t.Run(name, func(t *testing.T) {
			t.Setenv(name, "SYNTHETIC_SECRET_DO_NOT_ECHO")
			var out bytes.Buffer
			err := run(context.Background(), []string{"owner", "show", "--db-url-file", p}, &out)
			if err == nil || !strings.Contains(err.Error(), "ambient PG") || strings.Contains(err.Error()+out.String(), "SYNTHETIC_SECRET") {
				t.Fatal("ambient settings were not rejected safely before connection")
			}
		})
	}
}

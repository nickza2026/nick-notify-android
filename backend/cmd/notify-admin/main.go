// notify-admin is an explicit operator tool: no API startup or migration.
package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	backend "dev.notifyalarm/backend"
	_ "github.com/lib/pq"
)

const usage = "notify-admin owner show --db-url-file PATH\nnotify-admin owner reset-password --db-url-file PATH --confirm-username USER --password-file PATH\nnotify-admin owner revoke-sessions --db-url-file PATH --confirm-username USER\nInputs must be private regular UTF-8 files. No password arguments or environment inputs.\n"

func privateInput(path string, max int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > max {
		return nil, errors.New("invalid private input file")
	}
	// Windows ACLs must be restricted by the operator; POSIX mode bits are enforced.
	if info.Mode().Perm()&0077 != 0 && os.PathSeparator != '\\' {
		return nil, errors.New("private input permissions required")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.New("cannot open private input")
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) {
		return nil, errors.New("private input changed")
	}
	b, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil || int64(len(b)) > max || !utf8.Valid(b) {
		return nil, errors.New("invalid private input encoding or size")
	}
	b = bytes.TrimPrefix(b, []byte{0xef, 0xbb, 0xbf})
	if bytes.HasSuffix(b, []byte("\r\n")) {
		b = b[:len(b)-2]
	} else if bytes.HasSuffix(b, []byte("\n")) {
		b = b[:len(b)-1]
	}
	if len(b) == 0 || bytes.ContainsAny(b, "\r\n\x00") {
		return nil, errors.New("private input must contain one nonempty line")
	}
	return b, nil
}

func databaseURI(b []byte) (string, error) {
	u, err := url.Parse(string(b))
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() == "" || u.Fragment != "" {
		return "", errors.New("explicit PostgreSQL URI host required")
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return "", errors.New("invalid database URI")
	}
	// Only TLS file paths and an overridden connection timeout are accepted.
	// pq otherwise permits query options to override the URI identity/database.
	for key, values := range q {
		if len(values) != 1 {
			return "", errors.New("duplicate database URI option")
		}
		switch key {
		case "sslmode", "sslrootcert", "sslcert", "sslkey", "connect_timeout":
		default:
			return "", errors.New("unsupported database URI option")
		}
	}
	if u.User == nil || u.User.Username() == "" {
		return "", errors.New("explicit database user required")
	}
	if password, ok := u.User.Password(); !ok || password == "" {
		return "", errors.New("explicit database password required")
	}
	if strings.TrimPrefix(u.Path, "/") == "" {
		return "", errors.New("explicit database name required")
	}
	ssl := q.Get("sslmode")
	if ssl != "verify-full" && !(ssl == "disable" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return "", errors.New("explicit verified TLS required except loopback")
	}
	port := u.Port()
	if port == "" {
		port = "5432" // Fixed default, never PGPORT or a service file.
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", errors.New("invalid database port")
	}
	u.Host = net.JoinHostPort(u.Hostname(), port)
	// Fix the normal application schema; never inherit PGOPTIONS search_path.
	q.Set("options", "-c search_path=public -c statement_timeout=30000 -c lock_timeout=10000")
	q.Set("connect_timeout", "5")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func run(ctx context.Context, args []string, out io.Writer) error {
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		_, err := io.WriteString(out, usage)
		return err
	}
	if len(args) < 2 || args[0] != "owner" || (args[1] != "show" && args[1] != "reset-password" && args[1] != "revoke-sessions") {
		return errors.New("invalid command; use --help")
	}
	opts := map[string]string{}
	for i := 2; i < len(args); i += 2 {
		if i+1 >= len(args) {
			return errors.New("invalid options; use --help")
		}
		k := args[i]
		if k != "--db-url-file" && !((args[1] == "reset-password" || args[1] == "revoke-sessions") && k == "--confirm-username") && !(args[1] == "reset-password" && k == "--password-file") {
			return errors.New("invalid options; use --help")
		}
		if _, ok := opts[k]; ok || args[i+1] == "" {
			return errors.New("invalid options; use --help")
		}
		opts[k] = args[i+1]
	}
	if opts["--db-url-file"] == "" || (args[1] == "reset-password" && (opts["--confirm-username"] == "" || opts["--password-file"] == "")) {
		return errors.New("explicit input files and confirmation required; use --help")
	}
	if args[1] == "revoke-sessions" && opts["--confirm-username"] == "" {
		return errors.New("explicit input files and confirmation required; use --help")
	}
	b, err := privateInput(opts["--db-url-file"], 8192)
	if err != nil {
		return err
	}
	dsn, err := databaseURI(b)
	if err != nil {
		return err
	}
	var password []byte
	if args[1] == "reset-password" {
		password, err = privateInput(opts["--password-file"], 133)
		if err != nil {
			return err
		}
		if len(password) < 32 || len(password) > 128 {
			return errors.New("temporary password must be 32..128 UTF-8 bytes")
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	// This standalone process must not inherit libpq credentials, TLS file paths,
	// startup settings or unsupported PG variables (some make pq panic).
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(strings.ToUpper(name), "PG") {
			return errors.New("ambient PG settings are not allowed; clear them in this process before connecting")
		}
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return errors.New("database open failed")
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(0)
	db.SetConnMaxLifetime(30 * time.Second)
	if err = db.PingContext(ctx); err != nil {
		return errors.New("database connection failed")
	}
	if args[1] == "show" {
		s, e := backend.ShowDashboardOwner(ctx, db)
		if e != nil {
			return e
		}
		_, err = fmt.Fprintf(out, "username=%s\nmust_change_password=%t\n", s.Username, s.MustChangePassword)
		return err
	}
	if args[1] == "revoke-sessions" {
		if err = backend.RevokeDashboardOwnerSessions(ctx, db, opts["--confirm-username"]); err != nil {
			return err
		}
		_, err = io.WriteString(out, "Owner web/native login sessions revoked; devices and alerts preserved.\n")
		return err
	}
	if err = backend.ResetDashboardOwnerPassword(ctx, db, opts["--confirm-username"], string(password)); err != nil {
		return err
	}
	_, err = io.WriteString(out, "Owner password reset; all sessions revoked; password change required.\n")
	return err
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

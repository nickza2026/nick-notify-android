package backend

import (
	"fmt"
	postgres "github.com/fergusstrange/embedded-postgres"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// StartEmbedded is local-only; caller owns the runtime directory and must stop before removal.
func StartEmbedded(dir string) (*postgres.EmbeddedPostgres, string, error) {
	cache := os.Getenv("NOTIFY_PG_CACHE")
	if cache == "" {
		base, e := os.UserCacheDir()
		if e != nil {
			return nil, "", fmt.Errorf("embedded PostgreSQL cache unavailable")
		}
		cache = filepath.Join(base, "notify-alarm", "embedded-postgres")
	}
	if e := os.MkdirAll(cache, 0700); e != nil {
		return nil, "", fmt.Errorf("embedded PostgreSQL cache unavailable")
	}
	l, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		return nil, "", e
	}
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	cfg := postgres.DefaultConfig().Version(postgres.V16).Encoding("UTF8").Port(uint32(port)).RuntimePath(filepath.Join(dir, "runtime")).DataPath(filepath.Join(dir, "data")).CachePath(cache).BinariesPath(filepath.Join(dir, "binaries")).BinaryRepositoryURL("https://repo.maven.apache.org/maven2").StartParameters(map[string]string{"listen_addresses": "127.0.0.1"}).StartTimeout(60 * time.Second).Logger(io.Discard)
	p := postgres.NewDatabase(cfg)
	if e = p.Start(); e != nil {
		_ = p.Stop()
		return nil, "", fmt.Errorf("embedded PostgreSQL startup: %w", e)
	}
	return p, "postgres://postgres:postgres@127.0.0.1:" + strconv.Itoa(port) + "/postgres?sslmode=disable", nil
}

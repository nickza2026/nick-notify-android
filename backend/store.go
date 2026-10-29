package backend

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"time"
)

//go:embed migrations/*.sql
var migrations embed.FS

func Open(ctx context.Context, url string) (*sql.DB, error) {
	if url == "" {
		return nil, errors.New("DATABASE_URL required")
	}
	db, e := sql.Open("postgres", url)
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(12)
	if e = db.PingContext(ctx); e != nil {
		db.Close()
		return nil, fmt.Errorf("database unavailable: %w", e)
	}
	var encoding string
	if e = db.QueryRowContext(ctx, `SHOW server_encoding`).Scan(&encoding); e != nil {
		db.Close()
		return nil, errors.New("cannot verify PostgreSQL database encoding")
	}
	if encoding != "UTF8" {
		db.Close()
		return nil, errors.New("PostgreSQL database must use UTF8")
	}
	if e = Migrate(ctx, db); e != nil {
		db.Close()
		return nil, e
	}
	return db, nil
}
func Migrate(ctx context.Context, db *sql.DB) error {
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(739148521)`); e != nil {
		return e
	}
	for _, name := range []string{"001_init.sql", "002_dashboard_auth.sql"} {
		b, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, string(b)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type Alert struct {
	ID                 string     `json:"alert_id"`
	Title              string     `json:"title"`
	Message            string     `json:"message"`
	Importance         string     `json:"importance"`
	Status             string     `json:"status"`
	CreatedAt          time.Time  `json:"created_at"`
	ProviderAcceptedAt *time.Time `json:"provider_accepted_at"`
	ExpiresAt          time.Time  `json:"expires_at"`
	AcknowledgedAt     *time.Time `json:"acknowledged_at"`
	AckCount           int        `json:"ack_count"`
	LastAckAt          *time.Time `json:"last_ack_at"`
}
type Action struct {
	ClientActionID string     `json:"client_action_id"`
	ClientAckedAt  *time.Time `json:"client_acked_at"`
	ReceivedAt     time.Time  `json:"received_at"`
}

const alertColumns = `a.id,a.title,a.message,a.importance,a.outcome,a.created_at,a.provider_accepted_at,a.expires_at,a.first_ack_at,(SELECT COUNT(*) FROM ack_actions x WHERE x.alert_id=a.id),(SELECT MAX(x.received_at) FROM ack_actions x WHERE x.alert_id=a.id)`

func scanAlert(row interface{ Scan(...any) error }) (a Alert, e error) {
	var accepted, first, last sql.NullTime
	e = row.Scan(&a.ID, &a.Title, &a.Message, &a.Importance, &a.Status, &a.CreatedAt, &accepted, &a.ExpiresAt, &first, &a.AckCount, &last)
	if e != nil {
		return
	}
	a.CreatedAt = a.CreatedAt.UTC()
	a.ExpiresAt = a.ExpiresAt.UTC()
	if accepted.Valid {
		v := accepted.Time.UTC()
		a.ProviderAcceptedAt = &v
	}
	if first.Valid {
		v := first.Time.UTC()
		a.AcknowledgedAt = &v
	}
	if last.Valid {
		v := last.Time.UTC()
		a.LastAckAt = &v
	}
	return
}
func receipt(ctx context.Context, db *sql.DB, id string) (Alert, []Action, error) {
	tx, e := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if e != nil {
		return Alert{}, nil, e
	}
	defer tx.Rollback()
	a, e := scanAlert(tx.QueryRowContext(ctx, `SELECT `+alertColumns+` FROM alerts a WHERE a.id=$1`, id))
	if e != nil {
		return a, nil, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT client_action_id::text,client_acked_at,received_at FROM ack_actions WHERE alert_id=$1 ORDER BY received_at,client_action_id`, id)
	if e != nil {
		return a, nil, e
	}
	defer rows.Close()
	acts := []Action{}
	for rows.Next() {
		var x Action
		var t sql.NullTime
		if e = rows.Scan(&x.ClientActionID, &t, &x.ReceivedAt); e != nil {
			return a, nil, e
		}
		if t.Valid {
			v := t.Time.UTC()
			x.ClientAckedAt = &v
		}
		x.ReceivedAt = x.ReceivedAt.UTC()
		acts = append(acts, x)
	}
	if e = rows.Err(); e != nil {
		return a, nil, e
	}
	if e = rows.Close(); e != nil {
		return a, nil, e
	}
	return a, acts, tx.Commit()
}

type historyCursor struct {
	Created time.Time `json:"t"`
	ID      string    `json:"i"`
	From    string    `json:"f"`
	To      string    `json:"u"`
	Status  string    `json:"s"`
}

var errBadCursor = errors.New("invalid_cursor")

func history(ctx context.Context, db *sql.DB, from, to *time.Time, status string, limit int, cursor string) ([]Alert, *string, error) {
	var f, t string
	if from != nil {
		f = from.UTC().Format(time.RFC3339Nano)
	}
	if to != nil {
		t = to.UTC().Format(time.RFC3339Nano)
	}
	var c historyCursor
	if cursor != "" {
		b, e := base64.RawURLEncoding.DecodeString(cursor)
		if e != nil || len(b) > 2048 || json.Unmarshal(b, &c) != nil || !validID(c.ID) || c.Created.IsZero() || c.From != f || c.To != t || c.Status != status {
			return nil, nil, errBadCursor
		}
	}
	var since, until, beforeTime, beforeID any
	if from != nil {
		since = *from
	}
	if to != nil {
		until = *to
	}
	if cursor != "" {
		beforeTime = c.Created
		beforeID = c.ID
	}
	rows, e := db.QueryContext(ctx, `SELECT `+alertColumns+` FROM alerts a WHERE ($1::timestamptz IS NULL OR a.created_at >= $1) AND ($2::timestamptz IS NULL OR a.created_at < $2) AND ($3::text = 'all' OR a.outcome = $3 OR ($3='acknowledged' AND a.first_ack_at IS NOT NULL) OR ($3='pending_ack' AND a.outcome='provider_accepted' AND a.first_ack_at IS NULL)) AND ($4::timestamptz IS NULL OR (a.created_at,a.id)<($4,$5)) ORDER BY a.created_at DESC,a.id DESC LIMIT $6`, since, until, status, beforeTime, beforeID, limit+1)
	if e != nil {
		return nil, nil, e
	}
	defer rows.Close()
	items := []Alert{}
	for rows.Next() {
		a, e := scanAlert(rows)
		if e != nil {
			return nil, nil, e
		}
		items = append(items, a)
	}
	if e = rows.Err(); e != nil {
		return nil, nil, e
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		b, _ := json.Marshal(historyCursor{last.CreatedAt, last.ID, f, t, status})
		s := base64.RawURLEncoding.EncodeToString(b)
		next = &s
	}
	return items, next, nil
}

type Stats struct {
	TotalAlerts      int `json:"total_alerts"`
	ProviderAccepted int `json:"provider_accepted"`
	ProviderFailed   int `json:"provider_failed"`
	DeliveryUnknown  int `json:"delivery_unknown"`
	Acknowledged     int `json:"acknowledged"`
	PendingAck       int `json:"pending_ack"`
	AckActionCount   int `json:"ack_action_count"`
}

func stats(ctx context.Context, db *sql.DB, from, to *time.Time) (Stats, error) {
	var s Stats
	var f, t any
	if from != nil {
		f = *from
	}
	if to != nil {
		t = *to
	}
	e := db.QueryRowContext(ctx, `WITH scoped AS (SELECT * FROM alerts WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at < $2)) SELECT COUNT(*),COUNT(*) FILTER (WHERE outcome='provider_accepted'),COUNT(*) FILTER (WHERE outcome='provider_failed'),COUNT(*) FILTER (WHERE outcome='delivery_unknown'),COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM ack_actions x WHERE x.alert_id=scoped.id)),COUNT(*) FILTER (WHERE outcome='provider_accepted' AND NOT EXISTS(SELECT 1 FROM ack_actions x WHERE x.alert_id=scoped.id)),(SELECT COUNT(DISTINCT client_action_id) FROM ack_actions x JOIN scoped a ON a.id=x.alert_id) FROM scoped`, f, t).Scan(&s.TotalAlerts, &s.ProviderAccepted, &s.ProviderFailed, &s.DeliveryUnknown, &s.Acknowledged, &s.PendingAck, &s.AckActionCount)
	return s, e
}
func legacyID(id string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("notifyalarm:legacy:"+id)).String()
}
func digest(v string) []byte { h := sha256.Sum256([]byte(v)); return h[:] }
func validID(s string) bool {
	if len(s) < 1 || len(s) > 100 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

package backend

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"sync"
	"time"
)

type TargetSender interface {
	SendTo(context.Context, string, map[string]string, int) error
}
type legacyTarget interface{ HasLegacyTarget() bool }
type deliveryTarget struct {
	id, name, token, cap string
	hash                 []byte
}

func (a *API) reserveTargets(ctx context.Context, tx *sql.Tx, id string) ([]deliveryTarget, bool, error) {
	// Lock owner membership against concurrent register/revoke until the snapshot commits.
	var owner int
	if e := tx.QueryRowContext(ctx, `SELECT id FROM dashboard_owner WHERE id=1 FOR UPDATE`).Scan(&owner); e != nil && e != sql.ErrNoRows {
		return nil, false, e
	}
	var managed bool
	if e := tx.QueryRowContext(ctx, `SELECT managed FROM client_keys WHERE key_id='primary' AND owner_id=1`).Scan(&managed); e != nil && e != sql.ErrNoRows {
		return nil, false, e
	}
	if managed && len(a.DeviceTokenKey) != 32 {
		return nil, true, fail(503, "device_registration_not_configured")
	}
	rows, e := tx.QueryContext(ctx, `SELECT d.id::text,d.device_name,s.token_cipher,s.token_hash FROM client_devices d JOIN client_subscriptions s ON s.device_id=d.id WHERE d.active AND d.owner_id=1 AND s.key_id='primary' ORDER BY d.id LIMIT 21`)
	if e != nil {
		return nil, managed, e
	}
	targets := []deliveryTarget{}
	for rows.Next() {
		var v deliveryTarget
		var sealed []byte
		if e = rows.Scan(&v.id, &v.name, &sealed, &v.hash); e != nil {
			break
		}
		v.token, e = a.openToken(sealed)
		if e != nil {
			break
		}
		targets = append(targets, v)
	}
	if e == nil {
		e = rows.Err()
	}
	closeErr := rows.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		return nil, managed, e
	}
	if len(targets) > 20 {
		return nil, managed, fail(409, "device_limit_reached")
	}
	for i := range targets {
		random := make([]byte, 32)
		if _, e = rand.Read(random); e != nil {
			return nil, managed, e
		}
		targets[i].cap = base64.RawURLEncoding.EncodeToString(random)
		_, e = tx.ExecContext(ctx, `INSERT INTO device_deliveries(alert_id,device_id,device_name,token_hash,capability_hash) VALUES($1,$2,$3,$4,$5)`, id, targets[i].id, targets[i].name, targets[i].hash, digest(targets[i].cap))
		if e != nil {
			return nil, managed, e
		}
	}
	return targets, managed, nil
}

func (a *API) sendTargets(id string, expires time.Time, data map[string]string, targets []deliveryTarget) (string, string, time.Time, error) {
	sender := a.Sender.(TargetSender)
	var wg sync.WaitGroup
	slots := make(chan struct{}, 4)
	for _, t := range targets {
		t := t
		slots <- struct{}{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			payload := make(map[string]string, len(data)+2)
			for k, v := range data {
				payload[k] = v
			}
			payload["ack_token"] = t.cap
			payload["ack_url"] = a.AckBase + "/v1/alerts/" + id + "/ack"
			outcome, code := "provider_accepted", ""
			remaining := int(time.Until(expires).Seconds())
			if a.Now != nil {
				remaining = int(expires.Sub(a.now()).Seconds())
			}
			if remaining <= 0 {
				outcome, code = "provider_failed", "expired_before_send"
			} else {
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				err := sender.SendTo(ctx, t.token, payload, remaining)
				cancel()
				if err != nil {
					var se *SendError
					if errors.As(err, &se) && !se.Ambiguous {
						outcome, code = "provider_failed", se.Code
					} else {
						outcome, code = "delivery_unknown", "provider_delivery_unknown"
					}
				}
			}
			completed := a.now()
			var accepted any
			if outcome == "provider_accepted" {
				accepted = completed
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_, _ = a.DB.ExecContext(ctx, `UPDATE device_deliveries SET outcome=$3,failure_code=$4,completed_at=$5,provider_accepted_at=$6 WHERE alert_id=$1 AND device_id=$2 AND completed_at IS NULL`, id, t.id, outcome, nullable(code), completed, accepted)
			if code == "provider_unregistered" {
				_ = a.expireToken(ctx, t.id, t.hash, completed)
			}
		}()
	}
	wg.Wait()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var accepted, failed, unknown int
	e := a.DB.QueryRowContext(ctx, `SELECT count(*) FILTER(WHERE outcome='provider_accepted' AND completed_at IS NOT NULL),count(*) FILTER(WHERE outcome='provider_failed' AND completed_at IS NOT NULL),count(*) FILTER(WHERE completed_at IS NULL OR outcome='delivery_unknown') FROM device_deliveries WHERE alert_id=$1`, id).Scan(&accepted, &failed, &unknown)
	if e != nil {
		return "", "", time.Time{}, e
	}
	outcome, code := "delivery_unknown", "partial_provider_outcome"
	if accepted == len(targets) {
		outcome, code = "provider_accepted", ""
	} else if failed == len(targets) {
		outcome, code = "provider_failed", "provider_rejected"
		var reason sql.NullString
		_ = a.DB.QueryRowContext(ctx, `SELECT failure_code FROM device_deliveries WHERE alert_id=$1 ORDER BY device_id LIMIT 1`, id).Scan(&reason)
		if reason.Valid {
			code = reason.String
		}
	} else if accepted == 0 && failed == 0 {
		code = "provider_delivery_unknown"
	}
	completed := a.now()
	var acceptedAt any
	if outcome == "provider_accepted" {
		acceptedAt = completed
	}
	_, e = a.DB.ExecContext(ctx, `UPDATE alerts SET outcome=$2,completed_at=$3,provider_accepted_at=$4,failure_code=$5 WHERE id=$1 AND completed_at IS NULL`, id, outcome, completed, acceptedAt, nullable(code))
	return outcome, code, completed, e
}
func (a *API) expireToken(ctx context.Context, deviceID string, snapshotHash []byte, now time.Time) error {
	tx, e := a.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var owner int
	if e = tx.QueryRowContext(ctx, `SELECT id FROM dashboard_owner WHERE id=1 FOR UPDATE`).Scan(&owner); e != nil {
		return e
	}
	res, e := tx.ExecContext(ctx, `DELETE FROM client_subscriptions WHERE device_id=$1 AND token_hash=$2`, deviceID, snapshotHash)
	if e != nil {
		return e
	}
	n, e := res.RowsAffected()
	if e != nil {
		return e
	}
	if n == 1 {
		_, e = tx.ExecContext(ctx, `UPDATE client_devices SET active=false,updated_at=$2 WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM client_subscriptions WHERE device_id=$1)`, deviceID, now)
		if e != nil {
			return e
		}
	}
	return tx.Commit()
}

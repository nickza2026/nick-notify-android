package backend

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// RevokeDashboardOwnerSessions revokes local web/native logins only. It does
// not revoke Firebase credentials, deactivate devices, or acknowledge alerts.
func RevokeDashboardOwnerSessions(ctx context.Context, db *sql.DB, confirmUsername string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return errors.New("session revocation transaction failed")
	}
	defer tx.Rollback()
	var username string
	if err = tx.QueryRowContext(ctx, `SELECT username FROM dashboard_owner WHERE id=1 FOR UPDATE`).Scan(&username); err != nil {
		return errors.New("existing owner required")
	}
	if confirmUsername != username {
		return errors.New("owner confirmation mismatch")
	}
	for _, query := range []string{`DELETE FROM dashboard_sessions WHERE owner_id=1`, `DELETE FROM client_sessions WHERE owner_id=1`} {
		if _, err = tx.ExecContext(ctx, query); err != nil {
			return errors.New("session revocation failed; transaction rolled back")
		}
	}
	if err = tx.Commit(); err != nil {
		return errors.New("session revocation commit failed; verify status before further action")
	}
	return nil
}

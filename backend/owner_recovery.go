package backend

import (
	"context"
	"database/sql"
	"errors"
	"time"
	"unicode/utf8"
)

// OwnerRecoveryStatus deliberately excludes credential hashes.
type OwnerRecoveryStatus struct {
	Username           string
	MustChangePassword bool
}

// ShowDashboardOwner never bootstraps or migrates the database.
func ShowDashboardOwner(ctx context.Context, db *sql.DB) (OwnerRecoveryStatus, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var s OwnerRecoveryStatus
	err := db.QueryRowContext(ctx, `SELECT username,must_change_password FROM dashboard_owner WHERE id=1`).Scan(&s.Username, &s.MustChangePassword)
	if err != nil {
		return OwnerRecoveryStatus{}, errors.New("owner lookup failed; verify existing schema and owner")
	}
	return s, nil
}

// ResetDashboardOwnerPassword changes only credentials, throttles and sessions.
// The original bootstrap blacklist and device encryption material are preserved.
func ResetDashboardOwnerPassword(ctx context.Context, db *sql.DB, confirmUsername, temporaryPassword string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if !utf8.ValidString(temporaryPassword) || len(temporaryPassword) < 32 || len(temporaryPassword) > 128 {
		return errors.New("invalid temporary password")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return errors.New("recovery transaction failed")
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(739148522)`); err != nil {
		return errors.New("recovery lock failed")
	}
	var username, current, bootstrap string
	if err = tx.QueryRowContext(ctx, `SELECT username,password_hash,bootstrap_hash FROM dashboard_owner WHERE id=1 FOR UPDATE`).Scan(&username, &current, &bootstrap); err != nil {
		return errors.New("existing owner required")
	}
	if confirmUsername != username {
		return errors.New("owner confirmation mismatch")
	}
	select {
	case dashboardHashSlots <- struct{}{}:
		defer func() { <-dashboardHashSlots }()
	case <-ctx.Done():
		return errors.New("recovery cancelled")
	}
	for _, hash := range []string{current, bootstrap} {
		match, e := passwordMatches(temporaryPassword, hash)
		if e != nil || match {
			return errors.New("temporary password rejected")
		}
	}
	hash, err := passwordHash(temporaryPassword)
	if err != nil {
		return errors.New("password hashing failed")
	}
	if _, err = tx.ExecContext(ctx, `UPDATE dashboard_owner SET password_hash=$1,must_change_password=true,login_failures=0,login_window=NULL,change_failures=0,change_window=NULL WHERE id=1`, hash); err != nil {
		return errors.New("recovery update failed")
	}
	for _, query := range []string{`DELETE FROM dashboard_sessions`, `DELETE FROM client_sessions`} {
		if _, err = tx.ExecContext(ctx, query); err != nil {
			return errors.New("session revocation failed; recovery rolled back")
		}
	}
	if err = tx.Commit(); err != nil {
		return errors.New("recovery commit failed; verify status before any further action")
	}
	return nil
}

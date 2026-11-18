package backend

import (
	"context"
	"database/sql"
	"net/http"
	"os"
	"time"
	"unicode/utf8"
)

// GoogleIdentity contains only claims established by the Firebase verifier.
type GoogleIdentity struct {
	UID, Provider, Email, Tenant string
	EmailVerified                bool
}
type GoogleTokenVerifier interface {
	Verify(context.Context, string) (GoogleIdentity, error)
}

// Called only while holding the singleton owner row lock. This persistent gate
// survives an accidental configuration downgrade and password recovery.
func (a *API) passwordAuthAllowed(ctx context.Context, tx *sql.Tx) error {
	if a.AuthMode != "" && a.AuthMode != "password" {
		return fail(403, "password_auth_disabled")
	}
	var bound bool
	if e := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM owner_google_identity WHERE owner_id=1)`).Scan(&bound); e != nil {
		return e
	}
	if bound {
		return fail(403, "password_auth_disabled")
	}
	return nil
}

// ActivateGoogleAuth binds only an already bootstrapped owner. Initial binding
// and revocation share the same owner lock as every password session issuance.
func (a *API) ActivateGoogleAuth(ctx context.Context) error {
	if a.AuthMode != "google" || a.FirebaseProjectID == "" || a.FirebaseOwnerUID == "" || a.GoogleVerifier == nil || os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" {
		return fail(503, "google_auth_unavailable")
	}
	tx, e := a.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var id int
	if e = tx.QueryRowContext(ctx, `SELECT id FROM dashboard_owner WHERE id=1 FOR UPDATE`).Scan(&id); e != nil {
		return fail(503, "google_auth_unavailable")
	}
	var project, uid string
	e = tx.QueryRowContext(ctx, `SELECT project_id,uid FROM owner_google_identity WHERE owner_id=1`).Scan(&project, &uid)
	if e == sql.ErrNoRows {
		if _, e = tx.ExecContext(ctx, `INSERT INTO owner_google_identity(owner_id,project_id,uid,bound_at) VALUES(1,$1,$2,$3)`, a.FirebaseProjectID, a.FirebaseOwnerUID, a.now()); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `DELETE FROM dashboard_sessions`); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `DELETE FROM client_sessions`); e != nil {
			return e
		}
	} else if e != nil {
		return e
	} else if project != a.FirebaseProjectID || uid != a.FirebaseOwnerUID {
		return fail(503, "google_auth_unavailable")
	}
	return tx.Commit()
}

func (a *API) googleAuthConfig(w http.ResponseWriter, r *http.Request) error {
	if a.AuthMode == "" || a.AuthMode == "password" {
		var bound bool
		if e := a.DB.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM owner_google_identity WHERE owner_id=1)`).Scan(&bound); e != nil || bound {
			return fail(503, "google_auth_unavailable")
		}
		respond(w, 200, map[string]any{"mode": "password", "firebase_project_id": nil})
		return nil
	}
	if e := a.ActivateGoogleAuth(r.Context()); e != nil {
		return fail(503, "google_auth_unavailable")
	}
	respond(w, 200, map[string]any{"mode": "google", "firebase_project_id": a.FirebaseProjectID})
	return nil
}

func (a *API) googleLogin(w http.ResponseWriter, r *http.Request, native bool) error {
	if a.AuthMode == "" || a.AuthMode == "password" {
		return fail(403, "google_auth_disabled")
	}
	if e := a.ActivateGoogleAuth(r.Context()); e != nil {
		return fail(503, "google_auth_unavailable")
	}
	var token, installation *string
	if native {
		var v struct {
			Token        *string `json:"id_token"`
			Installation *string `json:"installation_id"`
		}
		if e := decode(r, &v); e != nil {
			return e
		}
		token, installation = v.Token, v.Installation
		if installation == nil || !canonicalUUID(*installation) {
			return fail(422, "invalid_installation_id")
		}
	} else {
		var v struct {
			Token *string `json:"id_token"`
		}
		if e := decode(r, &v); e != nil {
			return e
		}
		token = v.Token
	}
	if token == nil || len(*token) == 0 || len(*token) > 8192 || !utf8.ValidString(*token) {
		return fail(422, "invalid_id_token")
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	identity, e := a.GoogleVerifier.Verify(ctx, *token)
	if e != nil {
		return fail(401, "invalid_google_credentials")
	}
	if identity.UID != a.FirebaseOwnerUID {
		return fail(403, "google_account_not_allowed")
	}
	if identity.Provider != "google.com" || !identity.EmailVerified || identity.Email == "" || identity.Tenant != "" {
		return fail(401, "invalid_google_credentials")
	}
	tx, e := a.DB.BeginTx(r.Context(), nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var username string
	if e = tx.QueryRowContext(r.Context(), `SELECT username FROM dashboard_owner WHERE id=1 FOR UPDATE`).Scan(&username); e != nil {
		return fail(503, "google_auth_unavailable")
	}
	var project, uid string
	if e = tx.QueryRowContext(r.Context(), `SELECT project_id,uid FROM owner_google_identity WHERE owner_id=1`).Scan(&project, &uid); e != nil || project != a.FirebaseProjectID || uid != identity.UID {
		return fail(503, "google_auth_unavailable")
	}
	if _, e = tx.ExecContext(r.Context(), `UPDATE dashboard_owner SET must_change_password=false WHERE id=1`); e != nil {
		return e
	}
	var session string
	var expiry time.Time
	if native {
		session, expiry, e = newClientSession(r.Context(), tx, *installation, a.now())
	} else {
		session, expiry, e = newDashboardSession(r.Context(), tx, a.now())
	}
	if e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	result := map[string]any{"user": dashboardUser{username, false}, "expires_at": expiry}
	if native {
		result["access_token"] = session
	} else {
		result["session_token"] = session
	}
	respond(w, 200, result)
	return nil
}

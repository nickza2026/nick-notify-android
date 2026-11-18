package backend

import (
	"context"
	"errors"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"golang.org/x/oauth2"
	"google.golang.org/api/option"
)

type firebaseGoogleVerifier struct{ client *auth.Client }

// NewGoogleTokenVerifier uses a synthetic token source solely to prevent ADC
// discovery during SDK construction. It never calls privileged Auth RPCs.
// Public certificate fetching inside VerifyIDToken uses the SDK's unauthenticated
// certificate client; no service-account key or metadata service is required.
func NewGoogleTokenVerifier(ctx context.Context, project string) (GoogleTokenVerifier, error) {
	if project == "" || os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" {
		return nil, errors.New("google_auth_unavailable")
	}
	// Google transport can optionally discover enterprise private certificates
	// or S2A metadata independently of ADC. Neither is appropriate for this
	// public-certificate-only verifier; reject rather than inspect host files.
	if strings.EqualFold(os.Getenv("GOOGLE_API_USE_CLIENT_CERTIFICATE"), "true") || strings.EqualFold(os.Getenv("EXPERIMENTAL_GOOGLE_API_USE_S2A"), "true") {
		return nil, errors.New("google_auth_unavailable")
	}
	app, e := firebase.NewApp(ctx, &firebase.Config{ProjectID: project}, option.WithTokenSource(oauth2.StaticTokenSource(&oauth2.Token{AccessToken: "verification-only-not-a-credential"})))
	if e != nil {
		return nil, errors.New("google_auth_unavailable")
	}
	client, e := app.Auth(ctx)
	if e != nil {
		return nil, errors.New("google_auth_unavailable")
	}
	return &firebaseGoogleVerifier{client}, nil
}

func (v *firebaseGoogleVerifier) Verify(ctx context.Context, token string) (GoogleIdentity, error) {
	// Recheck at exchange time: the SDK must never verify using emulator bypass.
	if os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" {
		return GoogleIdentity{}, errors.New("invalid_google_credentials")
	}
	t, e := v.client.VerifyIDToken(ctx, token)
	if e != nil {
		return GoogleIdentity{}, errors.New("invalid_google_credentials")
	}
	email, _ := t.Claims["email"].(string)
	verified, _ := t.Claims["email_verified"].(bool)
	return GoogleIdentity{UID: t.UID, Provider: t.Firebase.SignInProvider, Tenant: t.Firebase.Tenant, Email: email, EmailVerified: verified}, nil
}

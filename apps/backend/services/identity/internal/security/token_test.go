package security

import (
	"testing"
	"time"
)

func TestAccessTokenRoundTrip(t *testing.T) {
	now := time.Now().UTC()
	token, err := SignAccessToken("secret", Claims{
		Subject: "usr_1",
		Email:   "dev@example.com",
		Name:    "Dev",
		Issued:  now.Unix(),
		Expiry:  now.Add(time.Minute).Unix(),
	})
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	claims, err := VerifyAccessToken("secret", token, now)
	if err != nil {
		t.Fatalf("verify token: %v", err)
	}
	if claims.Subject != "usr_1" || claims.Email != "dev@example.com" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

// Package security implements the access-token verification used by gateway
// middleware. It mirrors the HS256 JWT format issued by the iam service so the
// gateway can validate tokens without calling iam on every request.
//
// Token issuance lives in services/iam/internal/security/token.go.
// This package is verification-only.
package security

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type Claims struct {
	Subject string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Issued  int64  `json:"iat"`
	Expiry  int64  `json:"exp"`
}

var (
	ErrTokenShape     = errors.New("invalid token shape")
	ErrTokenSignature = errors.New("invalid token signature")
	ErrTokenExpired   = errors.New("token expired")
)

func VerifyAccessToken(secret, token string, now time.Time) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrTokenShape
	}
	expected := sign(secret, parts[0]+"."+parts[1])
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return Claims{}, ErrTokenSignature
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, fmt.Errorf("decode payload: %w", err)
	}
	var claims Claims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return Claims{}, fmt.Errorf("parse claims: %w", err)
	}
	if claims.Expiry <= now.Unix() {
		return Claims{}, ErrTokenExpired
	}
	return claims, nil
}

func sign(secret, input string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(input))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

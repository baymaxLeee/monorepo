package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
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

func SignAccessToken(secret string, claims Claims) (string, error) {
	header, err := encodeJSON(map[string]string{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		return "", err
	}
	payload, err := encodeJSON(claims)
	if err != nil {
		return "", err
	}
	signingInput := header + "." + payload
	return signingInput + "." + sign(secret, signingInput), nil
}

func VerifyAccessToken(secret, token string, now time.Time) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, fmt.Errorf("invalid token shape")
	}
	expected := sign(secret, parts[0]+"."+parts[1])
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return Claims{}, fmt.Errorf("invalid token signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, err
	}
	var claims Claims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return Claims{}, err
	}
	if claims.Expiry <= now.Unix() {
		return Claims{}, fmt.Errorf("token expired")
	}
	return claims, nil
}

func NewOpaqueToken() (plain string, digest string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("random token: %w", err)
	}
	plain = base64.RawURLEncoding.EncodeToString(raw)
	return plain, DigestToken(plain), nil
}

func DigestToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawStdEncoding.EncodeToString(sum[:])
}

func encodeJSON(v any) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func sign(secret, input string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(input))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

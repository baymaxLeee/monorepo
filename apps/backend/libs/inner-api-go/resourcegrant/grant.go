// Package resourcegrant seals short-lived resource claims for a specific workload.
// The execution host can present a grant but cannot recover its product scope.
package resourcegrant

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"

	"github.com/fernet/fernet-go"
)

const Lifetime = 30 * time.Minute
const Header = "X-MCP-Resource-Grant"

func key(audience, secret string) (*fernet.Key, error) {
	if secret == "" || audience == "" {
		return nil, errors.New("resource grant key is unavailable")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("platform/mcp/resource-grant/v1/" + audience))
	k := fernet.Key(mac.Sum(nil))
	return &k, nil
}

func Seal(audience, secret string, claims any, now time.Time) (string, error) {
	k, err := key(audience, secret)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	token, err := fernet.EncryptAndSignAtTime(payload, k, now)
	return string(token), err
}

func Open(audience, secret, token string, claims any) error {
	k, err := key(audience, secret)
	if err != nil {
		return err
	}
	payload := fernet.VerifyAndDecrypt([]byte(token), Lifetime, []*fernet.Key{k})
	if payload == nil {
		return errors.New("invalid or expired resource grant")
	}
	return json.Unmarshal(payload, claims)
}

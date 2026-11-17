package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
)

const envelopeVersion = "v1."

type SecretBox struct {
	aead cipher.AEAD
}

func NewSecretBox(encoded string) (*SecretBox, error) {
	key, err := base64.URLEncoding.DecodeString(encoded)
	if err != nil {
		key, err = base64.RawURLEncoding.DecodeString(encoded)
	}
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("ADMIN_SECRET_KEY must be a URL-safe base64 encoded 32-byte key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("initialize credential cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("initialize credential envelope: %w", err)
	}
	return &SecretBox{aead: aead}, nil
}

func (box *SecretBox) Encrypt(value string) (string, error) {
	nonce := make([]byte, box.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate credential nonce: %w", err)
	}
	envelope := box.aead.Seal(nonce, nonce, []byte(value), nil)
	return envelopeVersion + base64.RawURLEncoding.EncodeToString(envelope), nil
}

func (box *SecretBox) Decrypt(value string) (string, error) {
	if !strings.HasPrefix(value, envelopeVersion) {
		return "", fmt.Errorf("stored credential uses an unsupported encryption envelope")
	}
	envelope, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, envelopeVersion))
	if err != nil || len(envelope) < box.aead.NonceSize() {
		return "", fmt.Errorf("stored credential is unreadable; ADMIN_SECRET_KEY may have rotated")
	}
	nonce, ciphertext := envelope[:box.aead.NonceSize()], envelope[box.aead.NonceSize():]
	plain, err := box.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("stored credential is unreadable; ADMIN_SECRET_KEY may have rotated")
	}
	return string(plain), nil
}

func Mask(value string) string {
	if len(value) <= 8 {
		return repeat("*", len(value))
	}
	return value[:4] + "****" + value[len(value)-4:]
}

func repeat(value string, count int) string {
	result := ""
	for range count {
		result += value
	}
	return result
}

package security

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/pbkdf2"
)

const (
	passwordAlgorithm   = "pbkdf2-sha256"
	passwordIterations  = 210000
	saltBytes           = 16
	keyBytes            = 32
	maxPasswordBytes    = 1024
	maxEncodedHashBytes = 128
)

var ErrPasswordTooLong = fmt.Errorf("password exceeds %d bytes", maxPasswordBytes)

func HashPassword(password string) (string, error) {
	if len(password) > maxPasswordBytes {
		return "", ErrPasswordTooLong
	}
	salt := make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("random salt: %w", err)
	}
	key := pbkdf2.Key([]byte(password), salt, passwordIterations, keyBytes, sha256.New)
	return fmt.Sprintf(
		"%s$%d$%s$%s",
		passwordAlgorithm,
		passwordIterations,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

func VerifyPassword(encoded, password string) bool {
	if len(password) > maxPasswordBytes || len(encoded) > maxEncodedHashBytes {
		return false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != passwordAlgorithm {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations != passwordIterations {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil || len(salt) != saltBytes {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || len(expected) != keyBytes {
		return false
	}
	actual := pbkdf2.Key([]byte(password), salt, iterations, keyBytes, sha256.New)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

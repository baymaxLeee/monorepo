package security

import (
	"strings"
	"testing"
)

const oversizedPasswordBytes = 1025

func TestHashPassword(t *testing.T) {
	t.Run("round trips a valid password", func(t *testing.T) {
		encoded, err := HashPassword("correct horse battery staple")
		if err != nil {
			t.Fatalf("HashPassword() error = %v", err)
		}
		if !VerifyPassword(encoded, "correct horse battery staple") {
			t.Fatal("VerifyPassword() rejected the password used to create the hash")
		}
		if VerifyPassword(encoded, "wrong password") {
			t.Fatal("VerifyPassword() accepted a different password")
		}
	})

	t.Run("rejects a password beyond the resource budget", func(t *testing.T) {
		if _, err := HashPassword(strings.Repeat("a", oversizedPasswordBytes)); err == nil {
			t.Fatal("HashPassword() accepted a password above the 1 KiB budget")
		}
	})
}

func TestVerifyPassword(t *testing.T) {
	t.Run("rejects an oversized password before deriving a key", func(t *testing.T) {
		if VerifyPassword("pbkdf2-sha256$210000$$", strings.Repeat("a", oversizedPasswordBytes)) {
			t.Fatal("VerifyPassword() accepted an oversized password")
		}
	})

	for _, encoded := range []string{
		"pbkdf2-sha256$100000$$",
		"pbkdf2-sha256$210000$$",
		"pbkdf2-sha256$210000$not-base64$not-base64",
	} {
		t.Run("rejects malformed hash parameters/"+encoded, func(t *testing.T) {
			if VerifyPassword(encoded, "password") {
				t.Fatalf("VerifyPassword(%q) accepted malformed parameters", encoded)
			}
		})
	}
}

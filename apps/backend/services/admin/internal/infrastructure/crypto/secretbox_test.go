package crypto

import (
	"strings"
	"testing"
)

func TestSecretBoxRoundTripAndMask(t *testing.T) {
	codec, err := NewSecretBox("MFnLpzWN-y-Hh0aJtaxKXh4uOFcljnPC6FwpDF4S5Y8=")
	if err != nil {
		t.Fatal(err)
	}
	token, err := codec.Encrypt("sk-example-secret")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(token, envelopeVersion) {
		t.Fatalf("token has no version prefix: %q", token)
	}
	plain, err := codec.Decrypt(token)
	if err != nil {
		t.Fatal(err)
	}
	if plain != "sk-example-secret" {
		t.Fatalf("plain = %q", plain)
	}
	if got := Mask(plain); got != "sk-e****cret" {
		t.Fatalf("mask = %q", got)
	}
}

func TestSecretBoxRejectsUnsupportedAndTamperedEnvelopes(t *testing.T) {
	codec, err := NewSecretBox("MFnLpzWN-y-Hh0aJtaxKXh4uOFcljnPC6FwpDF4S5Y8=")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = codec.Decrypt("legacy-token"); err == nil {
		t.Fatal("unsupported envelope was accepted")
	}
	token, err := codec.Encrypt("secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = codec.Decrypt(token + "x"); err == nil {
		t.Fatal("tampered envelope was accepted")
	}
}

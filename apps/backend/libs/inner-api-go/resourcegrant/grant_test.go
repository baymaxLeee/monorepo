package resourcegrant

import (
	"testing"
	"time"
)

func TestRecipientExpiryAndConfidentiality(t *testing.T) {
	now := time.Now()
	token, err := Seal("canvas", "owner-secret", "workspace", now)
	if err != nil {
		t.Fatal(err)
	}
	var result string
	if err = Open("canvas", "owner-secret", token, &result); err != nil || result != "workspace" {
		t.Fatal("valid scope did not round-trip")
	}
	expired, err := Seal("canvas", "owner-secret", "workspace", now.Add(-Lifetime-time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range [][3]string{{"knowledge", "owner-secret", token}, {"canvas", "another-secret", token}, {"canvas", "owner-secret", expired}, {"canvas", "", "junk"}} {
		if Open(v[0], v[1], v[2], &result) == nil {
			t.Fatal("invalid scope accepted")
		}
	}
}

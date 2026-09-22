package provider

import "testing"

func TestSeedanceReferencePreservesReviewedAndInlineImages(t *testing.T) {
	for _, reference := range []string{
		"asset://asset-reviewed-1",
		"data:image/png;base64,cG5n",
	} {
		actual, err := seedanceReference(reference)
		if err != nil {
			t.Fatalf("seedanceReference(%q) returned error: %v", reference, err)
		}
		if actual != reference {
			t.Fatalf("seedanceReference(%q) = %q", reference, actual)
		}
	}
}

func TestSeedanceReferenceStillRejectsPrivateURLs(t *testing.T) {
	if _, err := seedanceReference("http://localhost:8000/reference.png"); err == nil {
		t.Fatal("expected private provider reference URL to be rejected")
	}
}

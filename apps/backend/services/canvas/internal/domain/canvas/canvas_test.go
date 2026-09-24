package canvas

import (
	"errors"
	"testing"
	"time"
)

func TestCoverRevisionPairLifecycle(t *testing.T) {
	now := time.Now().UTC()
	item, err := New(NewInput{ID: "canvas", TenantID: "tenant", ProjectID: "project", Name: "name", CoverImageAssetID: "asset", CoverImageRevisionID: "revision", CreatedBy: "user", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	item.CoverImageClaimGeneration = 4
	asset, revision := "", ""
	if err = item.Update("renamed", &asset, &revision, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if item.CoverImageAssetID != "" || item.CoverImageRevisionID != "" {
		t.Fatalf("cover not cleared: %#v", item)
	}
	if item.CoverImageClaimGeneration != 4 {
		t.Fatalf("claim generation = %d, want 4", item.CoverImageClaimGeneration)
	}
}

func TestCoverRevisionPairRequired(t *testing.T) {
	_, err := New(NewInput{ID: "canvas", TenantID: "tenant", ProjectID: "project", Name: "name", CoverImageAssetID: "asset", CreatedBy: "user", Now: time.Now().UTC()})
	if !errors.Is(err, ErrInvalidCoverImageReference) {
		t.Fatalf("error = %v", err)
	}
}

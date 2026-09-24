package project

import (
	"errors"
	"testing"
	"time"
)

func TestCoverRevisionPairLifecycle(t *testing.T) {
	now := time.Now().UTC()
	item, err := New(NewInput{ID: "project", TenantID: "tenant", Name: "name", CreatedBy: "user", MemberIDs: []string{"user"}, CoverImageAssetID: "asset", CoverImageRevisionID: "revision", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	item.CoverImageClaimGeneration = 4
	asset, revision := "", ""
	if err = item.Update("renamed", []string{"user"}, &asset, &revision, now.Add(time.Second)); err != nil {
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
	_, err := New(NewInput{ID: "project", TenantID: "tenant", Name: "name", CreatedBy: "user", MemberIDs: []string{"user"}, CoverImageAssetID: "asset", Now: time.Now().UTC()})
	if !errors.Is(err, ErrInvalidCoverImageReference) {
		t.Fatalf("error = %v", err)
	}
}

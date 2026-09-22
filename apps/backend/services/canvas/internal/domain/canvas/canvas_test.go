package canvas

import (
	"strings"
	"testing"
	"time"
)

func TestCanvasUpdateCoverSemantics(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	path := strings.Repeat("a", 64)
	canvas, err := New(NewInput{
		ID: "canvas", TenantID: "tenant", ProjectID: "project", Name: "Episode",
		CoverImagePath: &path, CreatedBy: "user", Now: now,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	canvas.CoverImageID = "cover"
	canvas.CoverImageSHA256 = strings.Repeat("b", 64)
	canvas.CoverImageContentType = "image/png"
	canvas.CoverImageSizeBytes = 128

	if err = canvas.Update("Episode", nil, now.Add(time.Second)); err != nil {
		t.Fatalf("Update(nil) error = %v", err)
	}
	if canvas.CoverImagePath == nil || canvas.CoverImageID != "cover" {
		t.Fatalf("Update(nil) changed cover = %#v", canvas)
	}

	empty := ""
	if err = canvas.Update("Episode", &empty, now.Add(2*time.Second)); err != nil {
		t.Fatalf("Update(empty) error = %v", err)
	}
	if canvas.CoverImagePath != nil || canvas.CoverImageID != "" || canvas.CoverImageSHA256 != "" ||
		canvas.CoverImageContentType != "" || canvas.CoverImageSizeBytes != 0 {
		t.Fatalf("Update(empty) cover = %#v", canvas)
	}
}

func TestCanvasRejectsDataURLCover(t *testing.T) {
	t.Parallel()

	value := "data:image/png;base64," + strings.Repeat("A", 256)
	_, err := New(NewInput{
		ID: "canvas", TenantID: "tenant", ProjectID: "project", Name: "Episode",
		CoverImagePath: &value, CreatedBy: "user", Now: time.Now().UTC(),
	})
	if err != ErrInvalidCoverImagePath {
		t.Fatalf("New() error = %v, want ErrInvalidCoverImagePath", err)
	}
}

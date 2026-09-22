package project

import (
	"strings"
	"testing"
	"time"
)

func TestProjectUpdateCoverSemantics(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	path := strings.Repeat("a", 64)
	project, err := New(NewInput{
		ID: "project", TenantID: "tenant", Name: "Project", CreatedBy: "user",
		MemberIDs: []string{"user"}, CoverImagePath: &path, Now: now,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	project.CoverImageID = "cover"
	project.CoverImageSHA256 = strings.Repeat("b", 64)
	project.CoverImageContentType = "image/png"
	project.CoverImageSizeBytes = 128

	if err = project.Update("Project", []string{"user"}, nil, now.Add(time.Second)); err != nil {
		t.Fatalf("Update(nil) error = %v", err)
	}
	if project.CoverImagePath == nil || project.CoverImageID != "cover" {
		t.Fatalf("Update(nil) changed cover = %#v", project)
	}

	empty := ""
	if err = project.Update("Project", []string{"user"}, &empty, now.Add(2*time.Second)); err != nil {
		t.Fatalf("Update(empty) error = %v", err)
	}
	if project.CoverImagePath != nil || project.CoverImageID != "" || project.CoverImageSHA256 != "" ||
		project.CoverImageContentType != "" || project.CoverImageSizeBytes != 0 {
		t.Fatalf("Update(empty) cover = %#v", project)
	}
}

func TestProjectRejectsDataURLCover(t *testing.T) {
	t.Parallel()

	value := "data:image/png;base64," + strings.Repeat("A", 256)
	_, err := New(NewInput{
		ID: "project", TenantID: "tenant", Name: "Project", CreatedBy: "user",
		MemberIDs: []string{"user"}, CoverImagePath: &value, Now: time.Now().UTC(),
	})
	if err != ErrInvalidCoverImagePath {
		t.Fatalf("New() error = %v, want ErrInvalidCoverImagePath", err)
	}
}

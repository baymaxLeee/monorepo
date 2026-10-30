package dbmigrate

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestChecksumsRejectSourceDrift(t *testing.T) {
	for _, mutation := range []string{"edit", "add", "remove", "wrong-version", "unknown-field", "duplicate-key", "extra-document", "missing-manifest"} {
		t.Run(mutation, func(t *testing.T) {
			root := t.TempDir()
			dir := filepath.Join(root, "v1.0.0")
			put(t, root, "v1.0.0/up.sql", "SELECT 1;")
			put(t, root, "v1.0.0/down.sql", "SELECT 2;")
			if err := WriteChecksums(dir); err != nil {
				t.Fatal(err)
			}
			if err := Validate(root, "", "up", nil); err != nil {
				t.Fatal(err)
			}
			manifest := filepath.Join(dir, "checksums.yaml")
			data, err := os.ReadFile(manifest)
			if err != nil {
				t.Fatal(err)
			}
			switch mutation {
			case "edit":
				put(t, root, "v1.0.0/up.sql", "SELECT 3;")
			case "add":
				put(t, root, "v1.0.0/helper.go", "package migration")
			case "remove":
				err = os.Remove(filepath.Join(dir, "v1.0.0.0.down.sql"))
			case "wrong-version":
				err = os.WriteFile(manifest, []byte(strings.ReplaceAll(string(data), "v1.0.0", "v2.0.0")), 0644)
			case "unknown-field":
				err = os.WriteFile(manifest, append(data, []byte("schemaChecksum: unknown\n")...), 0644)
			case "duplicate-key":
				err = os.WriteFile(manifest, append(data, []byte("version: v1.0.0\n")...), 0644)
			case "extra-document":
				err = os.WriteFile(manifest, append(data, []byte("---\nversion: v1.0.0\n")...), 0644)
			case "missing-manifest":
				err = os.Remove(manifest)
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := CheckChecksums(root); err == nil {
				t.Fatalf("accepted %s", mutation)
			}
		})
	}
}
func TestChecksumsGenerationIsDeterministic(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "v1.0.0")
	put(t, root, "v1.0.0/up.sql", "SELECT 1;")
	if err := WriteChecksums(dir); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(dir, "checksums.yaml"))
	if err := WriteChecksums(dir); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(filepath.Join(dir, "checksums.yaml"))
	if string(before) != string(after) {
		t.Fatal("unstable manifest")
	}
}

func TestChecksumManifestSymlinkRejected(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "v1.0.0")
	put(t, root, "v1.0.0/up.sql", "SELECT 1;")
	if err := WriteChecksums(dir); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "checksums.yaml")
	outside := filepath.Join(t.TempDir(), "manifest.yaml")
	if err := os.Rename(path, outside); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, path); err != nil {
		t.Fatal(err)
	}
	if err := CheckChecksums(root); err == nil {
		t.Fatal("accepted symlink manifest")
	}
}

func TestStepsAreOrderedAndContiguous(t *testing.T) {
	root := t.TempDir()
	release := filepath.Join(root, "v1.0.0")
	for i := 0; i <= 10; i++ {
		put(t, root, fmt.Sprintf("v1.0.0/%d/up.sql", i), "SELECT 1;")
	}
	if err := WriteChecksums(release); err != nil {
		t.Fatal(err)
	}
	ms, to, err := plan(root, "v1.0.0", "up", nil)
	if err != nil {
		t.Fatal(err)
	}
	if ms[to].version != "v1.0.0.10" || ms[2].version != "v1.0.0.2" {
		t.Fatal("steps not numerically sorted")
	}
	_, to, err = plan(root, "v1.0.0.2", "up", nil)
	if err != nil || to != 2 {
		t.Fatalf("precise target: %d %v", to, err)
	}
	if err := os.Remove(filepath.Join(release, "v1.0.0.3.up.sql")); err != nil {
		t.Fatal(err)
	}
	if err := WriteChecksums(release); err == nil {
		t.Fatal("accepted step gap")
	}
}

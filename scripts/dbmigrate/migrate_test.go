package dbmigrate

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func put(t *testing.T, root, name, body string) {
	t.Helper()
	parts := strings.Split(name, "/")
	if len(parts) == 2 && (strings.HasSuffix(name, ".sql") || strings.HasSuffix(name, ".go")) {
		name = parts[0] + "/" + parts[0] + ".0." + parts[1]
	}
	if len(parts) == 3 {
		name = parts[0] + "/" + parts[0] + "." + parts[1] + "." + parts[2]
	}
	p := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0644); err != nil {
		t.Fatal(err)
	}
}
func TestCatalogValidation(t *testing.T) {
	for _, tc := range []struct{ name, file, body, want string }{
		{"empty up", "v1.0.1/up.sql", "", "nonempty"},
		{"empty down", "v1.0.0/down.sql", "", "empty DOWN"},
		{"invalid version", "v01.0.1/up.sql", "SELECT 1;", "invalid migration directory"},
		{"unregistered go", "v1.0.1/up.go", "package migration", "not registered"},
		{"mixed modes", "v1.0.0/up.go", "package migration", "choose SQL or Go"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			put(t, root, "v1.0.0/up.sql", "SELECT 1;")
			put(t, root, tc.file, tc.body)
			err := Validate(root, "", "up", nil)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("want %s, got %v", tc.want, err)
			}
		})
	}
}
func TestNumericOrderingAndExplicitTargets(t *testing.T) {
	root := t.TempDir()
	for _, v := range []string{"v1.0.0", "v1.10.0", "v1.2.0"} {
		put(t, root, v+"/up.sql", "SELECT 1;")
	}
	for _, v := range []string{"v1.0.0", "v1.10.0", "v1.2.0"} {
		if err := WriteChecksums(filepath.Join(root, v)); err != nil {
			t.Fatal(err)
		}
	}
	ms, to, err := plan(root, "", "up", nil)
	if err != nil {
		t.Fatal(err)
	}
	if ms[to].version != "v1.10.0.0" || ms[1].version != "v1.2.0.0" {
		t.Fatal(ms)
	}
	for _, args := range [][2]string{{"", "down"}, {"v9.0.0", "up"}, {"v1.0.0", "sideways"}} {
		if err := Validate(root, args[0], args[1], nil); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
}
func TestGoSourcesMustMatchCompiledRegistration(t *testing.T) {
	root := t.TempDir()
	put(t, root, "v1.0.0/up.sql", "SELECT 1;")
	put(t, root, "v1.0.1/up.go", "package conversion")
	registry := map[string]GoMigration{"v1.0.1.0": {Up: func(context.Context, *sql.Tx) error { return nil }, Source: fstest.MapFS{"v1.0.1.0.up.go": {Data: []byte("package stale")}}}}
	if err := Validate(root, "", "up", registry); err == nil || !strings.Contains(err.Error(), "source mismatch") {
		t.Fatal(err)
	}
}

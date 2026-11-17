package application

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

func skillArchive(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range files {
		header := &zip.FileHeader{Name: name, Method: zip.Store}
		entry, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestExtractSkillArchiveStripsSingleRootAndClassifiesFiles(t *testing.T) {
	raw := skillArchive(t, map[string]string{
		"demo/SKILL.md":        "---\nname: demo\ndescription: Demo skill\n---\nBody",
		"demo/assets/data.bin": "\x00\x01\x02",
	})
	files, err := extractSkillArchive(raw, 1024, 4096)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 || files[0].Path != "SKILL.md" || files[1].Path != "assets/data.bin" {
		t.Fatalf("unexpected archive paths: %+v", files)
	}
	if !files[0].Inline || files[1].Inline {
		t.Fatalf("unexpected inline classification: %+v", files)
	}
}

func TestExtractSkillArchiveRejectsTraversalAndMissingManifest(t *testing.T) {
	for name, raw := range map[string][]byte{
		"traversal": skillArchive(t, map[string]string{"../SKILL.md": "bad"}),
		"manifest":  skillArchive(t, map[string]string{"README.md": "missing"}),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := extractSkillArchive(raw, 1024, 4096)
			if err == nil {
				t.Fatal("expected invalid archive to be rejected")
			}
			if name == "traversal" && !strings.Contains(err.Error(), "unsafe ZIP member path") {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

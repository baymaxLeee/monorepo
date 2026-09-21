package agent

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type LocalSkill struct {
	Key         string
	Name        string
	Description string
	Hash        string
	Filename    string
	Archive     []byte
}

type skillFrontmatter struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

var normalizedZipTime = time.Date(1980, time.January, 1, 0, 0, 0, 0, time.UTC)

func DiscoverSkills(root string) ([]LocalSkill, error) {
	entries, err := os.ReadDir(root)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read Agent skills root %q: %w", root, err)
	}
	skills := make([]LocalSkill, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		dir := filepath.Join(root, entry.Name())
		manifest := filepath.Join(dir, "SKILL.md")
		content, err := os.ReadFile(manifest)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read Agent skill manifest %q: %w", manifest, err)
		}
		metadata, err := parseSkillFrontmatter(content)
		if err != nil {
			return nil, fmt.Errorf("parse Agent skill manifest %q: %w", manifest, err)
		}
		archive, err := packageSkill(dir)
		if err != nil {
			return nil, fmt.Errorf("package Agent skill %q: %w", entry.Name(), err)
		}
		name := strings.TrimSpace(metadata.Name)
		if name == "" {
			name = entry.Name()
		}
		description := strings.TrimSpace(metadata.Description)
		if description == "" {
			description = "AgentFrame runtime skill " + name
		}
		digest := sha256.Sum256(archive)
		skills = append(skills, LocalSkill{
			Key: entry.Name(), Name: name, Description: description,
			Hash: hex.EncodeToString(digest[:]), Filename: entry.Name() + ".zip", Archive: archive,
		})
	}
	sort.Slice(skills, func(i, j int) bool { return skills[i].Key < skills[j].Key })
	return skills, nil
}

func parseSkillFrontmatter(content []byte) (skillFrontmatter, error) {
	normalized := strings.ReplaceAll(string(content), "\r\n", "\n")
	if !strings.HasPrefix(normalized, "---\n") {
		return skillFrontmatter{}, nil
	}
	end := strings.Index(normalized[4:], "\n---")
	if end < 0 {
		return skillFrontmatter{}, errors.New("frontmatter is not terminated")
	}
	var metadata skillFrontmatter
	if err := yaml.Unmarshal([]byte(normalized[4:4+end]), &metadata); err != nil {
		return skillFrontmatter{}, err
	}
	return metadata, nil
}

func packageSkill(root string) ([]byte, error) {
	type item struct {
		path string
		info fs.FileInfo
	}
	items := make([]item, 0)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink %q is not allowed", path)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.IsDir() && !info.Mode().IsRegular() {
			return fmt.Errorf("non-regular file %q is not allowed", path)
		}
		items = append(items, item{path: path, info: info})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool { return items[i].path < items[j].path })

	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, entry := range items {
		relative, err := filepath.Rel(root, entry.path)
		if err != nil {
			_ = writer.Close() //nolint:errcheck // The path error is the actionable packaging failure.
			return nil, err
		}
		name := filepath.ToSlash(relative)
		mode := fs.FileMode(0o644)
		method := uint16(zip.Deflate)
		if entry.info.IsDir() {
			name += "/"
			mode = fs.ModeDir | 0o755
			method = zip.Store
		} else if entry.info.Mode()&0o111 != 0 {
			mode = 0o755
		}
		header := &zip.FileHeader{Name: name, Method: method, Modified: normalizedZipTime}
		header.SetMode(mode)
		destination, err := writer.CreateHeader(header)
		if err != nil {
			_ = writer.Close() //nolint:errcheck // The header error is the actionable packaging failure.
			return nil, err
		}
		if entry.info.IsDir() {
			continue
		}
		content, err := os.ReadFile(entry.path)
		if err != nil {
			_ = writer.Close() //nolint:errcheck // The read error is the actionable packaging failure.
			return nil, err
		}
		if _, err := destination.Write(content); err != nil {
			_ = writer.Close() //nolint:errcheck // The write error is the actionable packaging failure.
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

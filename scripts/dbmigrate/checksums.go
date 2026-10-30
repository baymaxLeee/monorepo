package dbmigrate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// checksumDocument is a version's source manifest, not a database schema fingerprint.
type checksumDocument struct {
	Version   string         `yaml:"version"`
	Algorithm string         `yaml:"algorithm"`
	Steps     []stepChecksum `yaml:"steps"`
}
type stepChecksum struct {
	Version  string            `yaml:"version"`
	Checksum string            `yaml:"checksum"`
	Files    map[string]string `yaml:"files"`
}

// A release contains flat <release>.<step>.<direction>.<kind> artifacts.
func sourceChecksums(dir string) (checksumDocument, error) {
	release := filepath.Base(dir)
	result := checksumDocument{Version: release, Algorithm: "sha256"}
	if !versionPattern.MatchString(release) {
		return result, fmt.Errorf("invalid migration directory: %s", release)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return result, err
	}
	groups := map[uint64]*stepChecksum{}
	for _, entry := range entries {
		if entry.Name() == "checksums.yaml" || entry.Name() == "README.md" {
			if !entry.Type().IsRegular() {
				return result, fmt.Errorf("migration metadata must be a regular file: %s", entry.Name())
			}
			continue
		}
		rest := strings.TrimPrefix(entry.Name(), release+".")
		parts := strings.Split(rest, ".")
		if !entry.Type().IsRegular() || rest == entry.Name() || len(parts) != 3 || !stepPattern.MatchString(parts[0]) ||
			(parts[2] != "go" && (parts[2] != "sql" || (parts[1] != "up" && parts[1] != "down"))) || parts[1] == "" {
			return result, fmt.Errorf("unknown migration artifact: %s", filepath.Join(dir, entry.Name()))
		}
		number, e := strconv.ParseUint(parts[0], 10, 64)
		if e != nil {
			return result, e
		}
		version := release + "." + parts[0]
		if len(version) > 32 {
			return result, fmt.Errorf("migration version too long: %s", version)
		}
		if groups[number] == nil {
			groups[number] = &stepChecksum{Version: version, Files: map[string]string{}}
		}
		data, e := os.ReadFile(filepath.Join(dir, entry.Name()))
		if e != nil {
			return result, e
		}
		groups[number].Files[entry.Name()] = digest(data)
	}
	var numbers []uint64
	for n := range groups {
		numbers = append(numbers, n)
	}
	sort.Slice(numbers, func(i, j int) bool { return numbers[i] < numbers[j] })
	if len(numbers) == 0 {
		return result, fmt.Errorf("no migration steps: %s", dir)
	}
	for i, n := range numbers {
		if n != uint64(i) {
			return result, fmt.Errorf("migration steps must be contiguous from zero: %s", dir)
		}
		record := groups[n]
		data, _ := json.Marshal(record.Files)
		record.Checksum = digest(data)
		result.Steps = append(result.Steps, *record)
	}
	return result, nil
}

// WriteChecksums is an explicit authoring operation. Runtime never calls it.
// Regenerating a manifest cannot override the database's applied source checksums.
func WriteChecksums(dir string) error {
	document, err := sourceChecksums(dir)
	if err != nil {
		return err
	}
	data, err := yaml.Marshal(document)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".checksums-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Chmod(0644); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(dir, "checksums.yaml"))
}

func checkChecksums(dir string) error {
	actual, err := sourceChecksums(dir)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(dir, "checksums.yaml"))
	if err != nil {
		return fmt.Errorf("%s: checksums.yaml required: %w", dir, err)
	}
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	decoder.KnownFields(true)
	var expected checksumDocument
	if err = decoder.Decode(&expected); err != nil {
		return fmt.Errorf("%s: invalid checksums.yaml: %w", dir, err)
	}
	var extra any
	if err = decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("%s: checksums.yaml must contain one document", dir)
	}
	if !reflect.DeepEqual(expected, actual) {
		return fmt.Errorf("%s: checksums.yaml mismatch (version, algorithm or artifact set/content changed)", dir)
	}
	return nil
}

// CheckChecksums verifies a service's manifests offline, including Go sources
// without executing them or requiring a service's compiled registry.
func CheckChecksums(root string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	count := 0
	for _, entry := range entries {
		if entry.Name() == "README.md" && entry.Type().IsRegular() {
			continue
		}
		if !entry.IsDir() {
			return fmt.Errorf("unknown migration root artifact: %s", entry.Name())
		}
		if err = checkChecksums(filepath.Join(root, entry.Name())); err != nil {
			return err
		}
		count++
	}
	if count == 0 {
		return fmt.Errorf("no migration versions: %s", root)
	}
	return nil
}

// Check the bytes captured in the plan as well as the disk catalog, so edits
// between catalog discovery and validation cannot authorize different SQL.
func checkLoadedChecksums(root string, m migration) error {
	data, err := os.ReadFile(filepath.Join(root, m.release, "checksums.yaml"))
	if err != nil {
		return err
	}
	var manifest checksumDocument
	if err = yaml.Unmarshal(data, &manifest); err != nil {
		return err
	}
	loaded := map[string]string{}
	if m.goMigration == nil {
		loaded[m.version+".up.sql"] = m.checksum
		if m.downChecksum != "" {
			loaded[m.version+".down.sql"] = m.downChecksum
		}
	} else {
		files, err := fs.Glob(m.goMigration.Source, m.version+".*.go")
		if err != nil {
			return err
		}
		for _, name := range files {
			content, err := fs.ReadFile(m.goMigration.Source, name)
			if err != nil {
				return err
			}
			loaded[name] = digest(content)
		}
	}
	var expected map[string]string
	for _, step := range manifest.Steps {
		if step.Version == m.version {
			expected = step.Files
		}
	}
	if !reflect.DeepEqual(loaded, expected) {
		return fmt.Errorf("%s: checksum manifest does not match captured migration", m.version)
	}
	return nil
}

// Package dbmigrate adapts service-owned version directories to Goose's transactional
// Go migration API. Existing checksum history remains the authority during adoption.
package dbmigrate

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/pressly/goose/v3"
)

type Func func(context.Context, *sql.Tx) error

// GoMigration is registered by a service's compiled migration binary. Source must
// embed the complete version directory, so stale binaries cannot run new source.
type GoMigration struct {
	Up, Down Func
	Source   fs.FS
}

type migration struct {
	version                string
	parts                  [4]uint64
	release, directory     string
	up, down               []byte
	checksum, downChecksum string
	goMigration            *GoMigration
}

var stepPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

var versionPattern = regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

func digest(b []byte) string { return fmt.Sprintf("%x", sha256.Sum256(b)) }

func catalog(root string, registry map[string]GoMigration) ([]migration, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	var result []migration
	type stepRef struct{ release, version string }
	var steps []stepRef
	for _, entry := range entries {
		if entry.Name() == "README.md" && entry.Type().IsRegular() {
			continue
		}
		if !entry.IsDir() || !versionPattern.MatchString(entry.Name()) {
			return nil, fmt.Errorf("invalid migration directory: %s", entry.Name())
		}
		manifest, e := sourceChecksums(filepath.Join(root, entry.Name()))
		if e != nil {
			return nil, e
		}
		for _, step := range manifest.Steps {
			steps = append(steps, stepRef{entry.Name(), step.Version})
		}
	}
	for _, step := range steps {
		release, name := step.release, step.version
		sequence := strings.TrimPrefix(name, release+".")
		match := versionPattern.FindStringSubmatch(release)
		if len(name) > 32 {
			return nil, fmt.Errorf("migration version exceeds 32 characters: %s", name)
		}
		m := migration{version: name, release: release, directory: release}
		for i := 0; i < 3; i++ {
			m.parts[i], err = strconv.ParseUint(match[i+1], 10, 64)
			if err != nil {
				return nil, err
			}
		}
		m.parts[3], err = strconv.ParseUint(sequence, 10, 64)
		if err != nil {
			return nil, err
		}
		dir := filepath.Join(root, release)
		files, err := os.ReadDir(dir)
		if err != nil {
			return nil, err
		}
		var goFiles []string
		for _, f := range files {
			if f.IsDir() {
				return nil, fmt.Errorf("nested migration directory: %s", dir)
			}
			if strings.HasPrefix(f.Name(), name+".") && strings.HasSuffix(f.Name(), ".go") {
				goFiles = append(goFiles, f.Name())
			}
		}
		m.up, err = os.ReadFile(filepath.Join(dir, name+".up.sql"))
		if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		if len(goFiles) > 0 {
			if err == nil {
				return nil, fmt.Errorf("%s: choose SQL or Go, not both", name)
			}
			registered, ok := registry[name]
			if !ok || registered.Up == nil || registered.Source == nil {
				return nil, fmt.Errorf("%s: Go migration is not registered in this binary", name)
			}
			var bundle []byte
			for _, file := range goFiles {
				actual, e := os.ReadFile(filepath.Join(dir, file))
				if e != nil {
					return nil, e
				}
				embedded, e := fs.ReadFile(registered.Source, file)
				if e != nil || !bytes.Equal(actual, embedded) {
					return nil, fmt.Errorf("%s/%s: compiled migration source mismatch", name, file)
				}
				bundle = append(bundle, []byte(strings.TrimPrefix(file, name+".")+"\x00")...)
				bundle = append(bundle, actual...)
				bundle = append(bundle, 0)
			}
			embeddedFiles, e := fs.Glob(registered.Source, name+".*.go")
			if e != nil || len(embeddedFiles) != len(goFiles) {
				return nil, fmt.Errorf("%s: compiled migration file set mismatch", name)
			}
			m.goMigration = &registered
			m.checksum = digest(bundle)
			if registered.Down != nil {
				m.downChecksum = m.checksum
			}
			if _, e := os.Stat(filepath.Join(dir, name+".down.sql")); !os.IsNotExist(e) {
				return nil, fmt.Errorf("%s: Go migration must not have down.sql", name)
			}
		} else {
			if err != nil || len(bytes.TrimSpace(m.up)) == 0 {
				return nil, fmt.Errorf("%s: nonempty up.sql required", name)
			}
			m.checksum = digest(m.up)
			m.down, err = os.ReadFile(filepath.Join(dir, name+".down.sql"))
			if err != nil && !os.IsNotExist(err) {
				return nil, err
			}
			if err == nil {
				if len(bytes.TrimSpace(m.down)) == 0 {
					return nil, fmt.Errorf("%s: empty DOWN is not a rollback", name)
				}
				m.downChecksum = digest(m.down)
			}
		}
		result = append(result, m)
	}
	sort.Slice(result, func(i, j int) bool {
		for k := range result[i].parts {
			if result[i].parts[k] != result[j].parts[k] {
				return result[i].parts[k] < result[j].parts[k]
			}
		}
		return false
	})
	if len(result) == 0 || result[0].version != "v1.0.0.0" {
		return nil, fmt.Errorf("migration history must begin with v1.0.0.0")
	}
	for v := range registry {
		found := false
		for _, m := range result {
			if m.version == v && m.goMigration != nil {
				found = true
			}
		}
		if !found {
			return nil, fmt.Errorf("registered migration absent from catalog: %s", v)
		}
	}
	if err := CheckChecksums(root); err != nil {
		return nil, err
	}
	for _, m := range result {
		if err := checkLoadedChecksums(root, m); err != nil {
			return nil, err
		}
	}
	return result, nil
}

// Validate checks the complete catalog before bootstrap or connection side effects.
func Validate(root, target, direction string, registry map[string]GoMigration) error {
	_, _, err := plan(root, target, direction, registry)
	return err
}
func plan(root, target, direction string, registry map[string]GoMigration) ([]migration, int, error) {
	if direction != "up" && direction != "down" {
		return nil, 0, fmt.Errorf("invalid direction: %s", direction)
	}
	if direction == "down" && target == "" {
		return nil, 0, fmt.Errorf("DOWN requires an explicit target")
	}
	ms, err := catalog(root, registry)
	if err != nil {
		return nil, 0, err
	}
	if target == "" {
		target = ms[len(ms)-1].version
	}
	for i := len(ms) - 1; i >= 0; i-- {
		m := ms[i]
		if m.version == target || m.release == target {
			return ms, i, nil
		}
	}
	return nil, 0, fmt.Errorf("unknown target version: %s", target)
}

// Run executes a complete plan inside one Goose-managed transaction. The advisory
// lock, data mutations, head, active history and audit therefore commit together.
func Run(ctx context.Context, db *sql.DB, root, target, direction string, registry map[string]GoMigration) error {
	ms, to, err := plan(root, target, direction, registry)
	if err != nil {
		return err
	}
	callback := func(ctx context.Context, tx *sql.Tx) error { return execute(ctx, tx, ms, to, direction) }
	provider, err := goose.NewProvider(goose.DialectPostgres, db, nil, goose.WithDisableGlobalRegistry(true), goose.WithDisableVersioning(true), goose.WithGoMigrations(goose.NewGoMigration(1, &goose.GoFunc{RunTx: callback}, nil)))
	if err != nil {
		return err
	}
	_, err = provider.ApplyVersion(ctx, 1, true)
	return err
}

const metadataSQL = `
SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext('service-schema-migration'));
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE IF NOT EXISTS public.migration(id smallint PRIMARY KEY,version varchar(32) NOT NULL,checksum varchar(64) NOT NULL,update_time timestamptz NOT NULL);
INSERT INTO public.migration VALUES(1,'v0.0.0','',NOW()) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.migration_history(version varchar(32) PRIMARY KEY,checksum varchar(64) NOT NULL,applied_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS public.migration_sources(version varchar(32) PRIMARY KEY,up_checksum varchar(64) NOT NULL,down_checksum varchar(64) NOT NULL);
CREATE TABLE IF NOT EXISTS public.migration_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,version varchar(32) NOT NULL,checksum varchar(64) NOT NULL,direction text NOT NULL CHECK(direction IN ('up','down')),executed_at timestamptz NOT NULL DEFAULT NOW());
`

func execute(ctx context.Context, tx *sql.Tx, ms []migration, to int, direction string) error {
	if _, err := tx.ExecContext(ctx, metadataSQL); err != nil {
		return err
	}
	var count int
	var head, headChecksum string
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM public.migration").Scan(&count); err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("invalid migration head: expected one row")
	}
	if err := tx.QueryRowContext(ctx, "SELECT version,checksum FROM public.migration WHERE id=1").Scan(&head, &headChecksum); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO public.migration_history SELECT version,checksum,update_time FROM public.migration WHERE version IN ('v1.0.0','v1.0.0.0') AND NOT EXISTS(SELECT 1 FROM public.migration_history)`); err != nil {
		return err
	}
	byVersion := map[string]int{}
	for i, m := range ms {
		byVersion[m.version] = i
		if m.parts[3] == 0 {
			byVersion[m.release] = i
		}
	}
	current := -1
	if head != "v0.0.0" {
		var ok bool
		current, ok = byVersion[head]
		if !ok || ms[current].checksum != headChecksum {
			return fmt.Errorf("unknown migration head or checksum mismatch: %s", head)
		}
	} else if headChecksum != "" {
		return fmt.Errorf("invalid empty head checksum")
	}
	rows, err := tx.QueryContext(ctx, "SELECT version,checksum FROM public.migration_history")
	if err != nil {
		return err
	}
	active := map[string]bool{}
	for rows.Next() {
		var v, c string
		if err = rows.Scan(&v, &c); err != nil {
			rows.Close()
			return err
		}
		i, ok := byVersion[v]
		if !ok || ms[i].checksum != c {
			rows.Close()
			return fmt.Errorf("applied migration missing or checksum changed: %s", v)
		}
		if active[ms[i].version] {
			rows.Close()
			return fmt.Errorf("duplicate legacy/canonical history for %s", ms[i].version)
		}
		active[ms[i].version] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for i, m := range ms {
		if active[m.version] != (i <= current) {
			return fmt.Errorf("migration history has a gap or out-of-order version: %s", m.version)
		}
	}
	rows, err = tx.QueryContext(ctx, "SELECT version,checksum,direction FROM public.migration_audit")
	if err != nil {
		return err
	}
	for rows.Next() {
		var v, c, d string
		if err = rows.Scan(&v, &c, &d); err != nil {
			rows.Close()
			return err
		}
		i, ok := byVersion[v]
		if !ok {
			rows.Close()
			return fmt.Errorf("audited migration missing: %s", v)
		}
		want := ms[i].checksum
		if d == "down" {
			want = ms[i].downChecksum
		}
		if c != want {
			rows.Close()
			return fmt.Errorf("audited migration checksum changed: %s", v)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	rows, err = tx.QueryContext(ctx, "SELECT version,up_checksum,down_checksum FROM public.migration_sources")
	if err != nil {
		return err
	}
	for rows.Next() {
		var v, u, d string
		if err = rows.Scan(&v, &u, &d); err != nil {
			rows.Close()
			return err
		}
		i, ok := byVersion[v]
		if !ok || ms[i].checksum != u || ms[i].downChecksum != d {
			rows.Close()
			return fmt.Errorf("migration source checksum changed (UP or DOWN): %s", v)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	// Adopt previously verified sources once; never overwrite a recorded checksum.
	for i := 0; i <= current; i++ {
		m := ms[i]
		if _, err = tx.ExecContext(ctx, "INSERT INTO public.migration_sources SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM public.migration_sources WHERE version=$1 OR version=$4)", m.version, m.checksum, m.downChecksum, m.legacyVersion()); err != nil {
			return err
		}
	}

	if direction == "up" && to < current {
		return fmt.Errorf("UP cannot downgrade")
	}
	if direction == "down" && to > current {
		return fmt.Errorf("DOWN cannot upgrade")
	}
	if direction == "down" {
		for i := current; i > to; i-- {
			if ms[i].downChecksum == "" {
				return fmt.Errorf("missing DOWN migration: %s", ms[i].version)
			}
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO public.migration_audit(version,checksum,direction) SELECT h.version,h.checksum,'up' FROM public.migration_history h WHERE NOT EXISTS(SELECT 1 FROM public.migration_audit a WHERE a.version=h.version AND a.direction='up')`); err != nil {
		return err
	}
	step := 1
	first, last := current+1, to
	if direction == "down" {
		step = -1
		first = current
		last = to + 1
	}
	for i := first; (step == 1 && i <= last) || (step == -1 && i >= last); i += step {
		m := ms[i]
		data, checksum := m.up, m.checksum
		if direction == "down" {
			data, checksum = m.down, m.downChecksum
		}
		if m.goMigration != nil {
			f := m.goMigration.Up
			if direction == "down" {
				f = m.goMigration.Down
			}
			err = f(ctx, tx)
		} else {
			_, err = tx.ExecContext(ctx, string(data))
		}
		if err != nil {
			return fmt.Errorf("%s %s: %w", direction, m.version, err)
		}
		if direction == "up" {
			if _, err = tx.ExecContext(ctx, "INSERT INTO public.migration_sources SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM public.migration_sources WHERE version=$1 OR version=$4)", m.version, m.checksum, m.downChecksum, m.legacyVersion()); err != nil {
				return err
			}
		}

		if direction == "up" {
			_, err = tx.ExecContext(ctx, "INSERT INTO public.migration_history VALUES($1,$2,NOW())", m.version, m.checksum)
		} else {
			_, err = tx.ExecContext(ctx, "DELETE FROM public.migration_history WHERE version=$1 OR version=$2", m.version, m.legacyVersion())
		}
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO public.migration_audit(version,checksum,direction) VALUES($1,$2,$3)", m.version, checksum, direction); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, "UPDATE public.migration SET version=$1,checksum=$2,update_time=NOW() WHERE id=1", ms[to].version, ms[to].checksum)
	return err
}

// Three-part historical records always identify step zero, never the release head.
func (m migration) legacyVersion() string {
	if m.parts[3] == 0 {
		return m.release
	}
	return m.version
}

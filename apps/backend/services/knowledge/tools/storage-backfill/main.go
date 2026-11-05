// Offline owner-run migration. Stop Knowledge writers, apply schema expansion,
// then run this command before starting the single Storage-backed implementation.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type source struct{ table, owner, query string }

var sources = []source{
	{"file_entries", "file_entry", `SELECT id,user_id,tenant_id,workspace_id,path,mime_type,content,sha256,updated_at,COALESCE(asset_id::text,''),COALESCE(revision_id::text,''),true FROM file_entries WHERE id>$1 ORDER BY id LIMIT 100`},
	{"file_change_set_entries", "file_change_set_entry", `SELECT e.id,c.user_id,c.tenant_id,c.workspace_id,e.path,e.mime_type,e.content,e.sha256,e.updated_at,COALESCE(e.asset_id::text,''),COALESCE(e.revision_id::text,''),c.status='open' AND NOT e.deleted FROM file_change_set_entries e JOIN file_change_sets c ON c.id=e.change_set_id WHERE e.id>$1 ORDER BY e.id LIMIT 100`},
	{"documents", "document", `SELECT id,user_id,COALESCE(tenant_id,''),COALESCE(workspace_id,''),filename,mime_type,content_md,COALESCE(source_sha256,''),updated_at,COALESCE(asset_id::text,''),COALESCE(source_revision_id::text,''),true FROM documents WHERE id>$1 AND editable_source ORDER BY id LIMIT 100`},
}

type record struct {
	id, user, tenant, workspace, filename, mime, digest, asset, revision string
	content                                                              *string
	updated                                                              time.Time
	retained                                                             bool
}
type revision struct {
	Asset    string `json:"asset_id"`
	Revision string `json:"revision_id"`
	Digest   string `json:"sha256"`
	Size     int64  `json:"size_bytes"`
}
type migrator struct {
	db          *pgx.Conn
	http        *http.Client
	base, token string
}

func main() {
	verify := flag.Bool("verify", false, "verify every migrated reference and byte checksum without writing")
	flag.Parse()
	if err := run(context.Background(), *verify); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(ctx context.Context, verify bool) error {
	database, base, token := os.Getenv("KNOWLEDGE_DATABASE_URL"), os.Getenv("STORAGE_SERVICE_URL"), os.Getenv("INTERNAL_API_TOKEN")
	if database == "" || base == "" || token == "" {
		return errors.New("KNOWLEDGE_DATABASE_URL, STORAGE_SERVICE_URL and INTERNAL_API_TOKEN are required")
	}
	parsed, err := url.Parse(base)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return errors.New("invalid STORAGE_SERVICE_URL")
	}
	db, err := pgx.Connect(ctx, database)
	if err != nil {
		return errors.New("cannot connect to Knowledge database")
	}
	defer db.Close(ctx)
	// The advisory lock serializes migration invocations; CAS additionally rejects changed source rows.
	if _, err = db.Exec(ctx, `SELECT pg_advisory_lock(hashtextextended('knowledge-storage-backfill-v1',0))`); err != nil {
		return err
	}
	m := migrator{db: db, http: &http.Client{Timeout: 3 * time.Minute}, base: strings.TrimRight(base, "/"), token: token}
	for _, s := range sources {
		cursor := ""
		count := 0
		for {
			rows, err := db.Query(ctx, s.query, cursor)
			if err != nil {
				return err
			}
			batch := []record{}
			for rows.Next() {
				var r record
				if err = rows.Scan(&r.id, &r.user, &r.tenant, &r.workspace, &r.filename, &r.mime, &r.content, &r.digest, &r.updated, &r.asset, &r.revision, &r.retained); err != nil {
					rows.Close()
					return err
				}
				batch = append(batch, r)
			}
			rows.Close()
			if err = rows.Err(); err != nil {
				return err
			}
			if len(batch) == 0 {
				break
			}
			for _, r := range batch {
				if r.tenant == "" || r.workspace == "" {
					return fmt.Errorf("%s/%s: resolve missing tenant/workspace before migration", s.table, r.id)
				}
				if r.asset == "" || r.revision == "" {
					if verify {
						return fmt.Errorf("%s/%s: missing Storage revision", s.table, r.id)
					}
					if r.content == nil {
						return fmt.Errorf("%s/%s: no source bytes", s.table, r.id)
					}
					if err = m.migrate(ctx, s, r); err != nil {
						return fmt.Errorf("%s/%s: %w", s.table, r.id, err)
					}
				} else {
					if r.retained {
						if err = m.verify(ctx, r, r.asset, r.revision, r.digest); err != nil {
							return fmt.Errorf("%s/%s: %w", s.table, r.id, err)
						}
					}
					if err = m.retain(ctx, s, r, verify); err != nil {
						return fmt.Errorf("%s/%s: %w", s.table, r.id, err)
					}
					if !verify {
						if err = m.clearLegacy(ctx, s, r); err != nil {
							return err
						}
					}
				}
				count++
				cursor = r.id
			}
		}
		fmt.Printf("%s: %d rows verified\n", s.table, count)
	}
	return nil
}
func (m *migrator) request(ctx context.Context, method, route string, body io.Reader, media string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, m.base+route, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Caller-Service", "knowledge")
	req.Header.Set("X-Internal-Token", m.token)
	if media != "" {
		req.Header.Set("Content-Type", media)
	}
	res, err := m.http.Do(req)
	if err != nil {
		return nil, errors.New("Storage request failed")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		res.Body.Close()
		return nil, fmt.Errorf("Storage returned HTTP %d", res.StatusCode)
	}
	return res, nil
}
func (m *migrator) verify(ctx context.Context, r record, asset, rev, digest string) error {
	q := url.Values{"tenant_id": {r.tenant}, "workspace_id": {r.workspace}}
	res, err := m.request(ctx, "GET", "/internal/assets/"+url.PathEscape(asset)+"/revisions/"+url.PathEscape(rev)+"/content?"+q.Encode(), nil, "")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, res.Body); err != nil {
		return err
	}
	if hex.EncodeToString(hash.Sum(nil)) != digest {
		return errors.New("stored byte checksum mismatch")
	}
	return nil
}
func (m *migrator) migrate(ctx context.Context, s source, r record) error {
	body := *r.content
	sum := sha256.Sum256([]byte(body))
	digest := hex.EncodeToString(sum[:])
	if s.table != "documents" && r.digest != digest {
		return errors.New("legacy content checksum mismatch")
	}
	key := sha256.Sum256([]byte(s.table + "\x00" + r.id + "\x00" + r.filename + "\x00" + r.mime + "\x00" + digest))
	q := url.Values{"tenant_id": {r.tenant}, "workspace_id": {r.workspace}, "user_id": {r.user}, "filename": {path.Base(r.filename)}, "category": {"knowledge-file"}, "idempotency_key": {"backfill:" + hex.EncodeToString(key[:])}}
	res, err := m.request(ctx, "POST", "/internal/assets?"+q.Encode(), strings.NewReader(body), r.mime)
	if err != nil {
		return err
	}
	var rev revision
	err = json.NewDecoder(res.Body).Decode(&rev)
	res.Body.Close()
	if err != nil {
		return err
	}
	if rev.Digest != digest || rev.Size != int64(len(body)) {
		return errors.New("uploaded revision differs from legacy bytes")
	}
	if err = m.verify(ctx, r, rev.Asset, rev.Revision, digest); err != nil {
		return err
	}
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var updated int64
	if s.table == "documents" {
		tag, e := tx.Exec(ctx, `UPDATE documents SET asset_id=$1,source_revision_id=$2,source_sha256=$3,source_size=$4,source_mime_type=mime_type,source_filename=filename WHERE id=$5 AND updated_at=$6 AND asset_id IS NULL`, rev.Asset, rev.Revision, digest, rev.Size, r.id, r.updated)
		err = e
		updated = tag.RowsAffected()
	} else {
		// Table names come solely from the static source inventory, never request input.
		tag, e := tx.Exec(ctx, `UPDATE `+s.table+` SET asset_id=$1,revision_id=$2,size_bytes=$3 WHERE id=$4 AND updated_at=$5 AND asset_id IS NULL`, rev.Asset, rev.Revision, rev.Size, r.id, r.updated)
		err = e
		updated = tag.RowsAffected()
	}
	if err != nil {
		return err
	}
	if updated != 1 {
		return errors.New("source changed during migration; retry after stopping writers")
	}
	if r.retained {
		_, err = tx.Exec(ctx, `INSERT INTO asset_claim_intents(tenant_id,workspace_id,owner_type,owner_id,slot,asset_id,revision_id,kind,generation,desired_state,attempt_count,next_attempt_at,state_version,created_at,updated_at)
   VALUES($1,$2,$3,$4,'source',$5,$6,'strong',1,'active',0,now(),1,now(),now())
   ON CONFLICT(tenant_id,workspace_id,owner_type,owner_id,slot) DO UPDATE SET asset_id=EXCLUDED.asset_id,revision_id=EXCLUDED.revision_id,generation=asset_claim_intents.generation+1,desired_state='active',delivered_at=NULL,next_attempt_at=now(),lease_until=NULL,state_version=asset_claim_intents.state_version+1,updated_at=now()`, r.tenant, r.workspace, s.owner, r.id, rev.Asset, rev.Revision)
		if err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	r.asset, r.revision, r.digest = rev.Asset, rev.Revision, rev.Digest
	if err = m.retain(ctx, s, r, false); err != nil {
		return err
	}
	return m.clearLegacy(ctx, s, r)
}

func (m *migrator) retain(ctx context.Context, s source, r record, verifyOnly bool) error {
	if !r.retained {
		return nil
	}
	var generation int64
	var delivered *time.Time
	if err := m.db.QueryRow(ctx, `SELECT generation,delivered_at FROM asset_claim_intents
        WHERE tenant_id=$1 AND workspace_id=$2 AND owner_type=$3 AND owner_id=$4 AND slot='source'
        AND asset_id=$5 AND revision_id=$6 AND desired_state='active'`,
		r.tenant, r.workspace, s.owner, r.id, r.asset, r.revision).Scan(&generation, &delivered); err != nil {
		return errors.New("missing matching active retention intent")
	}
	if verifyOnly {
		if delivered == nil {
			return errors.New("retention intent has not been delivered")
		}
		return nil
	}
	common := map[string]any{"tenant_id": r.tenant, "workspace_id": r.workspace, "owner_type": s.owner, "owner_id": r.id, "slot": "source", "generation": generation}
	prepare := map[string]any{}
	for k, v := range common {
		prepare[k] = v
	}
	prepare["asset_id"] = r.asset
	prepare["revision_id"] = r.revision
	prepare["kind"] = "strong"
	for i, payload := range []map[string]any{prepare, common} {
		raw, _ := json.Marshal(payload)
		route := []string{"prepare", "activate"}[i]
		response, err := m.request(ctx, "POST", "/internal/claims:"+route, strings.NewReader(string(raw)), "application/json")
		if err != nil {
			return err
		}
		var claim struct {
			Status string `json:"status"`
		}
		err = json.NewDecoder(response.Body).Decode(&claim)
		response.Body.Close()
		if err != nil {
			return err
		}
		if i == 1 && claim.Status != "active" {
			return errors.New("Storage claim was not activated")
		}
	}
	tag, err := m.db.Exec(ctx, `UPDATE asset_claim_intents SET delivered_at=now() WHERE tenant_id=$1 AND workspace_id=$2 AND owner_type=$3 AND owner_id=$4 AND slot='source' AND generation=$5 AND desired_state='active' AND asset_id=$6 AND revision_id=$7`, r.tenant, r.workspace, s.owner, r.id, generation, r.asset, r.revision)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("retention changed during migration")
	}
	return nil
}
func (m *migrator) clearLegacy(ctx context.Context, s source, r record) error {
	if s.table == "documents" {
		return nil
	} // Converted/searchable text remains Knowledge-owned.
	_, err := m.db.Exec(ctx, `UPDATE `+s.table+` SET content=NULL WHERE id=$1 AND asset_id=$2 AND revision_id=$3 AND updated_at=$4`, r.id, r.asset, r.revision, r.updated)
	return err
}

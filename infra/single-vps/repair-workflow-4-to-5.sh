#!/usr/bin/env bash
# One-time repair for the 4.3.7 -> 5.0.5 migration journal gap.
set -euo pipefail
umask 077

if [ "$#" -ne 0 ]; then
    echo "Usage: bash repair-workflow-4-to-5.sh (run on the VPS)" >&2
    exit 1
fi

for container in monorepo-executor monorepo-workflow-db-init; do
    running=$(docker inspect --format '{{.State.Running}}' "$container")
    if [ "$running" = true ]; then
        echo "Stop $container before repair; keep deployment jobs paused during repair." >&2
        exit 1
    fi
done

# Use the exact image from the failed init, rather than a mutable registry tag.
image=$(docker inspect --format '{{.Image}}' monorepo-workflow-db-init)
work_dir=$(mktemp -d "${PWD}/workflow-repair.XXXXXXXX")
echo "Repair SQL and database backup: $work_dir"

docker run --rm -i --network none --entrypoint node "$image" \
    --input-type=module - /app/node_modules/@workflow/world-postgres > "$work_dir/repair.sql" <<'NODE'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.argv[2];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.version !== '5.0.5') throw new Error(`Expected 5.0.5, found ${pkg.version}`);
const folder = join(root, 'src/drizzle/migrations');
const { entries } = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
const previous = [1762873019948, 1763903867386, 1764815363008, 1765900000000,
    1765900000001, 1767723210726, 1768500000000, 1769500000000,
    1770000000000, 1770500000000, 1771000000000, 1782691200000];
const tags = ['0011_add_error_code', '0012_add_is_system', '0013_add_attributes',
    '0014_add_attr_set_event_unique_index'];
const migrations = tags.map(tag => {
    const entry = entries.find(entry => entry.tag === tag);
    if (!entry || !Number.isSafeInteger(entry.when)) throw new Error(`Missing migration: ${tag}`);
    const sql = readFileSync(join(folder, `${tag}.sql`), 'utf8');
    if (sql.includes('$repair$') || sql.includes('$migration$')) throw new Error('Unexpected SQL delimiter');
    return { ...entry, sql, hash: createHash('sha256').update(sql).digest('hex') };
});
const repaired = [...previous, ...migrations.map(m => m.when)].sort((a, b) => a - b);
const matches = migrations.map(m => `(created_at = ${m.when} AND hash = '${m.hash}')`).join(' OR ');
console.log(`\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE workflow_drizzle.workflow_migrations IN ACCESS EXCLUSIVE MODE;
DO $repair$
DECLARE recorded bigint[];
BEGIN
    SELECT array_agg(created_at ORDER BY created_at) INTO recorded
    FROM workflow_drizzle.workflow_migrations;
    IF recorded = ARRAY[${repaired}]::bigint[] AND
        (SELECT count(*) FROM workflow_drizzle.workflow_migrations WHERE ${matches}) = 4 THEN
        RAISE NOTICE 'Repair already applied; rerun the deployment to finish official migrations.';
        RETURN;
    END IF;
    IF recorded IS DISTINCT FROM ARRAY[${previous}]::bigint[] THEN
        RAISE EXCEPTION 'Unexpected migration history; refusing repair';
    END IF;
${migrations.map(m => `    EXECUTE $migration$${m.sql}$migration$;
    INSERT INTO workflow_drizzle.workflow_migrations (hash, created_at)
    VALUES ('${m.hash}', ${m.when});`).join('\n')}
END
$repair$;
COMMIT;`);
NODE

docker exec monorepo-postgres pg_dump -U workflow -d workflow -Fc > "$work_dir/workflow.dump"
test -s "$work_dir/workflow.dump"
docker exec -i monorepo-postgres pg_restore --list < "$work_dir/workflow.dump" > /dev/null
docker exec -i monorepo-postgres psql -X -v ON_ERROR_STOP=1 -U workflow -d workflow < "$work_dir/repair.sql"
echo "Repair complete. Keep $work_dir/workflow.dump; rerun deploy-single-vps to finish official migrations."

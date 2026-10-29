"""Exercise the one-time repair against official migration SQL in disposable Postgres."""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time
import unittest
import urllib.request
import uuid


ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / "apps/backend/services/executor/node_modules/@workflow/world-postgres"
SCRIPT = ROOT / "infra/single-vps/repair-workflow-4-to-5.sh"


def run(*args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, **kwargs)


class WorkflowRepairTest(unittest.TestCase):
    def test_upgrade(self):
        container = f"workflow-repair-test-{uuid.uuid4().hex[:10]}"
        started = run(
            "docker",
            "run",
            "-d",
            "--rm",
            "--name",
            container,
            "-e",
            "POSTGRES_USER=workflow",
            "-e",
            "POSTGRES_DB=workflow",
            "-e",
            "POSTGRES_PASSWORD=repair-test-only",
            "-p",
            "127.0.0.1::5432",
            "postgres:16-alpine",
        )
        self.assertEqual(started.returncode, 0, started.stderr)
        self.addCleanup(run, "docker", "rm", "-f", container)
        for _ in range(100):
            if (
                run(
                    "docker", "exec", container, "pg_isready", "-U", "workflow"
                ).returncode
                == 0
            ):
                break
            time.sleep(0.2)
        else:
            self.fail("PostgreSQL did not become ready")

        def sql(body):
            return run(
                "docker",
                "exec",
                "-i",
                container,
                "psql",
                "-X",
                "-At",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "workflow",
                "-d",
                "workflow",
                input=body,
            )

        url = "https://registry.npmjs.org/@workflow/world-postgres/-/world-postgres-4.3.7.tgz"
        with urllib.request.urlopen(url, timeout=30) as response:
            archive = tarfile.open(fileobj=io.BytesIO(response.read()), mode="r:gz")
        prefix = "package/src/drizzle/migrations/"
        journal = json.load(archive.extractfile(prefix + "meta/_journal.json"))
        statements = [
            "CREATE SCHEMA workflow_drizzle; CREATE TABLE "
            "workflow_drizzle.workflow_migrations "
            "(id serial primary key, hash text not null, created_at bigint);"
        ]
        for entry in journal["entries"]:
            body = archive.extractfile(prefix + entry["tag"] + ".sql").read()
            digest = hashlib.sha256(body).hexdigest()
            statements.extend(
                [
                    body.decode(),
                    "INSERT INTO workflow_drizzle.workflow_migrations "
                    f"(hash, created_at) VALUES ('{digest}', {entry['when']});",
                ]
            )
        seeded = sql("\n".join(statements))
        self.assertEqual(seeded.returncode, 0, seeded.stderr)
        sentinel = sql(
            "INSERT INTO workflow.workflow_runs (id, deployment_id, name, status) "
            "VALUES ('repair-sentinel', 'test', 'repair-test', 'completed');"
        )
        self.assertEqual(sentinel.returncode, 0, sentinel.stderr)

        port = run("docker", "port", container, "5432").stdout.strip().split(":")[-1]
        env = dict(
            os.environ,
            WORKFLOW_POSTGRES_URL=f"postgres://workflow:repair-test-only@127.0.0.1:{port}/workflow",
        )

        def setup():
            return run("node", str(PACKAGE / "bin/setup.js"), env=env)

        failed = setup()
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("column run.attributes does not exist", failed.stderr)

        generator = SCRIPT.read_text().split("<<'NODE'\n", 1)[1].split("\nNODE", 1)[0]
        generated = run(
            "node", "--input-type=module", "-", str(PACKAGE), input=generator
        )
        self.assertEqual(generated.returncode, 0, generated.stderr)
        repair = generated.stdout

        # Fail at the third DDL statement: earlier DDL and journal inserts must roll back.
        self.assertEqual(
            sql(
                "ALTER TABLE workflow.workflow_runs ADD COLUMN attributes jsonb;"
            ).returncode,
            0,
        )
        self.assertNotEqual(sql(repair).returncode, 0)
        self.assertEqual(
            sql(
                "SELECT count(*) FROM workflow_drizzle.workflow_migrations;"
            ).stdout.strip(),
            "12",
        )
        self.assertEqual(
            sql(
                "SELECT count(*) FROM information_schema.columns WHERE "
                "table_schema='workflow' AND table_name='workflow_runs' "
                "AND column_name='error_code';"
            ).stdout.strip(),
            "0",
        )
        self.assertEqual(
            sql(
                "ALTER TABLE workflow.workflow_runs DROP COLUMN attributes;"
            ).returncode,
            0,
        )

        with tempfile.TemporaryFile() as backup:
            subprocess.run(
                [
                    "docker",
                    "exec",
                    container,
                    "pg_dump",
                    "-U",
                    "workflow",
                    "-d",
                    "workflow",
                    "-Fc",
                ],
                stdout=backup,
                check=True,
            )
            backup.seek(0)
            subprocess.run(
                ["docker", "exec", "-i", container, "pg_restore", "--list"],
                stdin=backup,
                stdout=subprocess.DEVNULL,
                check=True,
            )

        for _ in range(2):
            repaired = sql(repair)
            self.assertEqual(repaired.returncode, 0, repaired.stderr)
        upgraded = setup()
        self.assertEqual(upgraded.returncode, 0, upgraded.stderr)
        self.assertEqual(
            sql(
                "SELECT count(*) FROM workflow_drizzle.workflow_migrations;"
            ).stdout.strip(),
            "28",
        )
        self.assertEqual(
            sql(
                "SELECT id FROM workflow.workflow_runs WHERE id='repair-sentinel';"
            ).stdout.strip(),
            "repair-sentinel",
        )
        self.assertIn("Unexpected migration history", sql(repair).stderr)


if __name__ == "__main__":
    unittest.main()

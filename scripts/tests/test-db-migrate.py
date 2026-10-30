"""Run the production migration entry point against disposable PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]


def run(*args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, **kwargs)


class MigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="migration-test-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.fixtures = Path(cls.temp.name)
        cls.container = f"migration-test-{uuid.uuid4().hex[:10]}"
        result = run(
            "docker",
            "run",
            "-d",
            "--rm",
            "--name",
            cls.container,
            "-e",
            "POSTGRES_USER=workflow",
            "-e",
            "POSTGRES_PASSWORD=migration-test-only",
            "-v",
            f"{ROOT}:/repo:ro",
            "-v",
            f"{cls.fixtures}:/fixtures:ro",
            "pgvector/pgvector:pg16",
        )
        if result.returncode:
            raise RuntimeError(result.stderr)
        cls.addClassCleanup(run, "docker", "rm", "-f", cls.container)
        for _ in range(100):
            if (
                run(
                    "docker",
                    "exec",
                    cls.container,
                    "pg_isready",
                    "-h",
                    "127.0.0.1",
                    "-U",
                    "workflow",
                ).returncode
                == 0
            ):
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("PostgreSQL did not become ready")

    def sql(self, db, statement):
        result = run(
            "docker",
            "exec",
            "-i",
            self.container,
            "psql",
            "-X",
            "-At",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "workflow",
            "-d",
            db,
            input=statement,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def service(
        self,
        name,
        baseline="CREATE TABLE public.keep_data (value text); INSERT INTO public.keep_data VALUES ('keep');\n",
    ):
        directory = self.fixtures / name
        (directory / "migrations/versions").mkdir(parents=True)
        (directory / "migrations/versions/v1.0.0.sql").write_text(baseline)
        return directory

    def migrate(self, service, target=None, tcp=False):
        if tcp:
            command = [
                "docker",
                "exec",
                "-e",
                "DB_MIGRATE_TRANSPORT=tcp",
                "-e",
                "POSTGRES_ADMIN_USER=workflow",
                "-e",
                "POSTGRES_ADMIN_PASSWORD=migration-test-only",
                self.container,
                "bash",
                "/repo/scripts/db-migrate.sh",
                f"/fixtures/{service.name}",
            ]
            return run(*command, *([target] if target else []))
        env = {
            **os.environ,
            "POSTGRES_CONTAINER": self.container,
            "POSTGRES_ADMIN_USER": "workflow",
            "POSTGRES_ADMIN_PASSWORD": "migration-test-only",
            "DB_MIGRATE_TRANSPORT": "docker",
        }
        for name in ("DATABASE_USER", "DATABASE_PASSWORD"):
            env.pop(name, None)
        return run(
            "bash",
            str(ROOT / "scripts/db-migrate.sh"),
            str(service),
            *([target] if target else []),
            env=env,
        )

    def success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_other_service_baselines_still_install_and_repeat(self):
        services = ROOT / "apps/backend/services"
        for source in sorted(services.glob("*/migrations/versions")):
            name = source.parents[1].name
            if name == "canvas":
                continue
            with self.subTest(service=name):
                target = self.fixtures / name / "migrations/versions"
                shutil.copytree(source, target)
                service = self.fixtures / name
                self.success(self.migrate(service, tcp=True))
                self.success(self.migrate(service, tcp=True))
                self.assertEqual(
                    self.sql(
                        name.replace("-", "_"),
                        "SELECT count(*) FROM public.migration_history;",
                    ),
                    str(len(list(source.glob("*.sql")))),
                )

    def test_canvas_existing_data_upgrade_and_fresh_install(self):
        source = ROOT / "apps/backend/services/canvas/migrations/versions"
        service = self.service("canvas", (source / "v1.0.0.sql").read_text())
        self.success(self.migrate(service))
        self.sql(
            "canvas",
            "DROP TABLE IF EXISTS public.migration_history; CREATE TABLE public.keep_data(value text); INSERT INTO public.keep_data VALUES ('historical canvas data');",
        )
        self.sql(
            "canvas",
            "INSERT INTO public.projects (id,tenant_id,name,created_by,created_at,updated_at,deleted_at) VALUES ('project','tenant','historical project','alice',NOW(),NOW(),0); INSERT INTO public.canvases (id,tenant_id,project_id,name,created_by,created_at,updated_at,deleted_at) VALUES ('canvas','tenant','project','historical canvas','alice',NOW(),NOW(),0); INSERT INTO public.canvas_nodes (id,tenant_id,project_id,canvas_id,type,storyboard_rank,revision,created_by,created_at,updated_at,deleted_at,node_data) VALUES ('node','tenant','project','canvas',1,0,7,'alice',NOW(),NOW(),0,'{\"text\":\"历史正文\"}');",
        )
        shutil.copy(source / "v1.0.1.sql", service / "migrations/versions/v1.0.1.sql")
        self.success(self.migrate(service))
        self.assertEqual(
            self.sql("canvas", "SELECT value FROM public.keep_data;"),
            "historical canvas data",
        )
        self.assertEqual(
            self.sql("canvas", "SELECT version FROM public.migration WHERE id=1;"),
            "v1.0.1",
        )
        self.assertEqual(
            self.sql("canvas", "SELECT count(*) FROM public.migration_history;"), "2"
        )
        self.assertEqual(
            self.sql("canvas", "SELECT name FROM public.canvases WHERE id='canvas';"),
            "historical canvas",
        )
        self.assertEqual(
            self.sql(
                "canvas",
                "SELECT revision,node_data->>'text' FROM public.canvas_nodes WHERE id='node';",
            ),
            "7|历史正文",
        )
        self.assertEqual(
            self.sql(
                "canvas",
                "SELECT to_regclass('public.canvas_events'),to_regclass('public.canvas_event_heads');",
            ),
            "canvas_events|canvas_event_heads",
        )
        self.success(self.migrate(service, tcp=True))
        fresh = self.service("fresh_canvas", (source / "v1.0.0.sql").read_text())
        shutil.copy(source / "v1.0.1.sql", fresh / "migrations/versions/v1.0.1.sql")
        self.success(self.migrate(fresh, tcp=True))
        schema = "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('canvas_events','canvas_event_heads') ORDER BY table_name,ordinal_position;"
        self.assertEqual(self.sql("canvas", schema), self.sql("fresh_canvas", schema))

    def test_numeric_order_idempotency_history_and_downgrade(self):
        service = self.service("ordered")
        versions = service / "migrations/versions"
        (versions / "v1.10.0.sql").write_text(
            "ALTER TABLE public.keep_data ADD COLUMN last_value text DEFAULT 'after'; UPDATE public.keep_data SET last_value=second_value;"
        )
        (versions / "v1.2.0.sql").write_text(
            "ALTER TABLE public.keep_data ADD COLUMN second_value text DEFAULT 'before';"
        )
        self.success(self.migrate(service))
        self.success(self.migrate(service))
        self.assertEqual(
            self.sql("ordered", "SELECT value,last_value FROM public.keep_data;"),
            "keep|before",
        )
        self.assertNotEqual(self.migrate(service, "v1.2.0").returncode, 0)
        (versions / "v1.0.0.sql").write_text("SELECT 1;")
        changed = self.migrate(service)
        self.assertNotEqual(changed.returncode, 0)
        self.assertIn("checksum", changed.stderr)
        self.assertEqual(
            self.sql("ordered", "SELECT value FROM public.keep_data;"), "keep"
        )

    def test_failure_rolls_back_schema_and_history_then_retries(self):
        service = self.service("rollback")
        self.success(self.migrate(service))
        upgrade = service / "migrations/versions/v1.0.1.sql"
        upgrade.write_text(
            "ALTER TABLE public.keep_data ADD COLUMN extra text; SELECT 1 / 0;"
        )
        self.assertNotEqual(self.migrate(service).returncode, 0)
        self.assertEqual(
            self.sql("rollback", "SELECT version FROM public.migration;"), "v1.0.0"
        )
        self.assertEqual(
            self.sql("rollback", "SELECT count(*) FROM public.migration_history;"), "1"
        )
        self.assertEqual(
            self.sql(
                "rollback",
                "SELECT count(*) FROM information_schema.columns WHERE table_name='keep_data' AND column_name='extra';",
            ),
            "0",
        )
        upgrade.write_text("ALTER TABLE public.keep_data ADD COLUMN extra text;")
        self.success(self.migrate(service))
        self.assertEqual(
            self.sql("rollback", "SELECT value FROM public.keep_data;"), "keep"
        )

    def test_missing_history_and_inserted_older_version_are_rejected(self):
        service = self.service("gaps")
        versions = service / "migrations/versions"
        (versions / "v1.2.0.sql").write_text(
            "INSERT INTO public.keep_data VALUES ('new');"
        )
        self.success(self.migrate(service))
        (versions / "v1.1.0.sql").write_text("DELETE FROM public.keep_data;")
        self.assertNotEqual(self.migrate(service).returncode, 0)
        self.assertEqual(
            self.sql("gaps", "SELECT count(*) FROM public.keep_data;"), "2"
        )
        (versions / "v1.1.0.sql").unlink()
        (versions / "v1.2.0.sql").unlink()
        self.assertNotEqual(self.migrate(service).returncode, 0)
        self.assertEqual(
            self.sql("gaps", "SELECT version FROM public.migration;"), "v1.2.0"
        )

    def test_legacy_checksum_mismatch_does_not_rewrite_history(self):
        service = self.service("legacy_mismatch")
        self.success(self.migrate(service))
        self.sql("legacy_mismatch", "DROP TABLE public.migration_history;")
        baseline = service / "migrations/versions/v1.0.0.sql"
        baseline.write_text(baseline.read_text() + "SELECT 1;")
        self.assertNotEqual(self.migrate(service).returncode, 0)
        self.assertEqual(
            self.sql(
                "legacy_mismatch",
                "SELECT to_regclass('public.migration_history') IS NULL;",
            ),
            "t",
        )
        self.assertEqual(
            self.sql("legacy_mismatch", "SELECT value FROM public.keep_data;"), "keep"
        )

    def test_parallel_upgrade_runs_once(self):
        service = self.service("parallel")
        self.success(self.migrate(service))
        (service / "migrations/versions/v1.0.1.sql").write_text(
            "SELECT pg_sleep(0.4); INSERT INTO public.keep_data VALUES ('once');"
        )
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.migrate(service), range(2)))
        for result in results:
            self.success(result)
        self.assertEqual(
            self.sql(
                "parallel", "SELECT count(*) FROM public.keep_data WHERE value='once';"
            ),
            "1",
        )


if __name__ == "__main__":
    unittest.main()

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


class VersionFiles:
    def __init__(self, root, direction="up"):
        self.root, self.direction = root, direction

    def mkdir(self):
        self.root.mkdir(parents=True, exist_ok=True)

    def __truediv__(self, name):
        directory = self.root / name.removesuffix(".sql")
        directory.mkdir(parents=True, exist_ok=True)
        return directory / (directory.name + ".0." + self.direction + ".sql")


class MigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="migration-test-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.fixtures = Path(cls.temp.name)
        cls.native = cls.fixtures / "db-migrate-native"
        cls.linux = cls.fixtures / "db-migrate-linux"
        module = ROOT / "scripts/dbmigrate"
        for output, extra in [(cls.native, {}), (cls.linux, {"GOOS": "linux", "CGO_ENABLED": "0"})]:
            result = run("go", "build", "-o", str(output), "./cmd/db-migrate", cwd=module, env={**os.environ, "GOWORK": "off", **extra})
            if result.returncode:
                raise RuntimeError(result.stderr)
        for suffix, extra in [("native", {}), ("linux", {"GOOS": "linux", "CGO_ENABLED": "0"})]:
            result = run("go", "build", "-o", str(cls.fixtures / f"go-fixture-{suffix}"), "./internal/testfixture/cmd", cwd=module, env={**os.environ, "GOWORK": "off", **extra})
            if result.returncode:
                raise RuntimeError(result.stderr)
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
        (directory / "migrations/v1.0.0").mkdir(parents=True)
        (directory / "migrations/v1.0.0/v1.0.0.0.up.sql").write_text(baseline)
        return directory

    def migrate(self, service, target=None, tcp=False, direction="up", go=False, refresh=True):
        # Most cases deliberately regenerate release manifests to exercise the
        # independent database-history protection. Drift tests disable this.
        if refresh:
            for directory in (service / "migrations").iterdir():
                if not directory.is_dir():
                    continue
                run(str(self.native), "checksums-write", str(directory))
        if tcp:
            command = [
                "docker",
                "exec",
                "-e",
                "DB_MIGRATE_TRANSPORT=tcp",
                "-e",
                f"DB_MIGRATE_BINARY=/fixtures/{'go-fixture-linux' if go else 'db-migrate-linux'}",
                "-e",
                "POSTGRES_ADMIN_USER=workflow",
                "-e",
                "POSTGRES_ADMIN_PASSWORD=migration-test-only",
                self.container,
                "bash",
                "/repo/scripts/db-migrate.sh",
                f"/fixtures/{service.name}",
            ]
            return run(*command, target or "", direction)
        env = {
            **os.environ,
            "POSTGRES_CONTAINER": self.container,
            "POSTGRES_ADMIN_USER": "workflow",
            "POSTGRES_ADMIN_PASSWORD": "migration-test-only",
            "DB_MIGRATE_TRANSPORT": "docker",
            "DB_MIGRATE_BINARY": str(self.fixtures / "go-fixture-native" if go else self.native),
            "DB_MIGRATE_DOCKER_BINARY": str(self.fixtures / "go-fixture-linux" if go else self.linux),
        }
        for name in ("DATABASE_USER", "DATABASE_PASSWORD"):
            env.pop(name, None)
        return run(
            "bash",
            str(ROOT / "scripts/db-migrate.sh"),
            str(service),
            target or "",
            direction,
            env=env,
        )

    def success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_other_service_baselines_still_install_and_repeat(self):
        services = ROOT / "apps/backend/services"
        for source in sorted(services.glob("*/migrations")):
            name = source.parent.name
            if name == "canvas":
                continue
            with self.subTest(service=name):
                target = self.fixtures / name / "migrations"
                shutil.copytree(source, target)
                service = self.fixtures / name
                self.success(self.migrate(service, tcp=True))
                self.success(self.migrate(service, tcp=True))
                self.assertEqual(
                    self.sql(
                        name.replace("-", "_"),
                        "SELECT count(*) FROM public.migration_history;",
                    ),
                    str(len(list(source.glob("v*/*.up.sql")))),
                )

    def test_canvas_existing_data_upgrade_and_fresh_install(self):
        source = ROOT / "apps/backend/services/canvas/migrations"
        service = self.service("canvas", (source / "v1.0.0/v1.0.0.0.up.sql").read_text())
        self.success(self.migrate(service))
        self.sql(
            "canvas",
            "DROP TABLE IF EXISTS public.migration_history; CREATE TABLE public.keep_data(value text); INSERT INTO public.keep_data VALUES ('historical canvas data');",
        )
        self.sql(
            "canvas",
            "INSERT INTO public.projects (id,tenant_id,name,created_by,created_at,updated_at,deleted_at) VALUES ('project','tenant','historical project','alice',NOW(),NOW(),0); INSERT INTO public.canvases (id,tenant_id,project_id,name,created_by,created_at,updated_at,deleted_at) VALUES ('canvas','tenant','project','historical canvas','alice',NOW(),NOW(),0); INSERT INTO public.canvas_nodes (id,tenant_id,project_id,canvas_id,type,storyboard_rank,revision,created_by,created_at,updated_at,deleted_at,node_data) VALUES ('node','tenant','project','canvas',1,0,7,'alice',NOW(),NOW(),0,'{\"text\":\"历史正文\"}');",
        )
        shutil.copytree(source / "v1.0.1", service / "migrations/v1.0.1")
        self.success(self.migrate(service))
        self.assertEqual(
            self.sql("canvas", "SELECT value FROM public.keep_data;"),
            "historical canvas data",
        )
        self.assertEqual(
            self.sql("canvas", "SELECT version FROM public.migration WHERE id=1;"),
            "v1.0.1.0",
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
        fresh = self.service("fresh_canvas", (source / "v1.0.0/v1.0.0.0.up.sql").read_text())
        shutil.copytree(source / "v1.0.1", fresh / "migrations/v1.0.1")
        self.success(self.migrate(fresh, tcp=True))
        schema = "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('canvas_events','canvas_event_heads') ORDER BY table_name,ordinal_position;"
        self.assertEqual(self.sql("canvas", schema), self.sql("fresh_canvas", schema))

    def test_numeric_order_idempotency_history_and_downgrade(self):
        service = self.service("ordered")
        versions = VersionFiles(service / "migrations")
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
        upgrade = VersionFiles(service / "migrations") / "v1.0.1.sql"
        upgrade.write_text(
            "ALTER TABLE public.keep_data ADD COLUMN extra text; SELECT 1 / 0;"
        )
        self.assertNotEqual(self.migrate(service).returncode, 0)
        self.assertEqual(
            self.sql("rollback", "SELECT version FROM public.migration;"), "v1.0.0.0"
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
        versions = VersionFiles(service / "migrations")
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
        shutil.rmtree(service / "migrations/v1.1.0")
        (versions / "v1.2.0.sql").unlink()
        shutil.rmtree(service / "migrations/v1.2.0")
        self.assertNotEqual(self.migrate(service).returncode, 0)
        self.assertEqual(
            self.sql("gaps", "SELECT version FROM public.migration;"), "v1.2.0.0"
        )

    def test_legacy_checksum_mismatch_does_not_rewrite_history(self):
        service = self.service("legacy_mismatch")
        self.success(self.migrate(service))
        self.sql("legacy_mismatch", "DROP TABLE public.migration_history;")
        baseline = service / "migrations/v1.0.0/v1.0.0.0.up.sql"
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

    def test_data_roundtrip_and_failed_down_are_atomic(self):
        service = self.service("roundtrip")
        versions = VersionFiles(service / "migrations")
        down = VersionFiles(service / "migrations", "down")
        down.mkdir()
        (versions / "v1.0.1.sql").write_text("UPDATE keep_data SET value=value || '-converted';")
        reverse = down / "v1.0.1.sql"
        reverse.write_text("UPDATE keep_data SET value=left(value, length(value)-10); SELECT 1 / (CASE WHEN (SELECT blocked FROM down_guard) THEN 0 ELSE 1 END);")
        self.success(self.migrate(service))
        self.sql("roundtrip", "CREATE TABLE down_guard(blocked bool); ALTER TABLE down_guard OWNER TO roundtrip; INSERT INTO down_guard VALUES (true);")
        self.assertNotEqual(self.migrate(service, "v1.0.0", direction="down").returncode, 0)
        self.assertEqual(self.sql("roundtrip", "SELECT value FROM keep_data"), "keep-converted")
        self.assertEqual(self.sql("roundtrip", "SELECT version FROM migration"), "v1.0.1.0")
        self.sql("roundtrip", "UPDATE down_guard SET blocked=false;")
        self.success(self.migrate(service, "v1.0.0", tcp=True, direction="down"))
        self.success(self.migrate(service, "v1.0.0", direction="down"))
        self.assertEqual(self.sql("roundtrip", "SELECT value FROM keep_data"), "keep")
        self.success(self.migrate(service))
        self.assertEqual(self.sql("roundtrip", "SELECT value FROM keep_data"), "keep-converted")
        self.assertEqual(self.sql("roundtrip", "SELECT count(*) FROM migration_audit WHERE direction='down'"), "1")
        reverse.write_text("SELECT 1;")
        self.assertNotEqual(self.migrate(service, "v1.0.0", direction="down").returncode, 0)

    def test_canvas_down_preserves_events_and_roundtrip(self):
        service = self.fixtures / "canvas_reverse"
        shutil.copytree(ROOT / "apps/backend/services/canvas/migrations", service / "migrations")
        self.success(self.migrate(service))
        self.sql("canvas_reverse", "INSERT INTO canvas_events VALUES ('canvas', 1, '{}', NOW());")
        result = self.migrate(service, "v1.0.0", direction="down")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("persisted events", result.stderr)
        self.assertEqual(self.sql("canvas_reverse", "SELECT count(*) FROM canvas_events"), "1")
        self.assertEqual(self.sql("canvas_reverse", "SELECT version FROM migration"), "v1.0.1.0")
        self.sql("canvas_reverse", "DELETE FROM canvas_events;")
        self.success(self.migrate(service, "v1.0.0", direction="down"))
        self.assertEqual(self.sql("canvas_reverse", "SELECT to_regclass('canvas_events') IS NULL"), "t")
        self.success(self.migrate(service))
        self.assertEqual(self.sql("canvas_reverse", "SELECT count(*) FROM canvas_events"), "0")

    def test_missing_down_and_wrong_direction_are_rejected(self):
        service = self.service("irreversible")
        (VersionFiles(service / "migrations") / "v1.0.1.sql").write_text("SELECT 1;")
        self.success(self.migrate(service, "v1.0.0"))
        self.assertNotEqual(self.migrate(service, "v1.0.1", direction="down").returncode, 0)
        self.success(self.migrate(service))
        self.assertNotEqual(self.migrate(service, "v1.0.0", direction="down").returncode, 0)
        self.assertEqual(self.sql("irreversible", "SELECT version FROM migration"), "v1.0.1.0")

    def test_reverse_order_concurrency_and_audit_after_downgrade(self):
        service = self.service("reverse_order")
        versions = VersionFiles(service / "migrations")
        down = VersionFiles(service / "migrations", "down")
        down.mkdir()
        (versions / "v1.2.0.sql").write_text("ALTER TABLE keep_data ADD COLUMN extra text; UPDATE keep_data SET extra=value;")
        (versions / "v1.10.0.sql").write_text("ALTER TABLE keep_data RENAME COLUMN extra TO renamed;")
        (down / "v1.2.0.sql").write_text("ALTER TABLE keep_data DROP COLUMN extra;")
        (down / "v1.10.0.sql").write_text("ALTER TABLE keep_data RENAME COLUMN renamed TO extra;")
        self.success(self.migrate(service))
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.migrate(service, "v1.0.0", direction="down"), range(2)))
        for result in results:
            self.success(result)
        self.assertEqual(self.sql("reverse_order", "SELECT value FROM keep_data"), "keep")
        self.assertEqual(self.sql("reverse_order", "SELECT string_agg(version, ',' ORDER BY id) FROM migration_audit WHERE direction='down'"), "v1.10.0.0,v1.2.0.0")
        (versions / "v1.2.0.sql").write_text("SELECT 1;")
        self.assertNotEqual(self.migrate(service).returncode, 0)

    def test_compiled_go_data_conversion_and_source_integrity(self):
        service = self.service("go_conversion", "CREATE TABLE keep_data(value text); INSERT INTO keep_data VALUES ('{\"name\":\"历史正文\"}');")
        shutil.copytree(ROOT / "scripts/dbmigrate/internal/testfixture/migrations/v1.0.1", service / "migrations/v1.0.1")
        self.assertNotEqual(self.migrate(service).returncode, 0)
        self.success(self.migrate(service, go=True))
        self.assertEqual(self.sql("go_conversion", "SELECT value::jsonb->>'displayName' FROM keep_data"), "历史正文")
        self.success(self.migrate(service, "v1.0.0", direction="down", go=True, tcp=True))
        self.assertEqual(self.sql("go_conversion", "SELECT value::jsonb->>'name' FROM keep_data"), "历史正文")
        self.sql("go_conversion", "INSERT INTO keep_data VALUES ('{\"other\":true}');")
        self.assertNotEqual(self.migrate(service, go=True).returncode, 0)
        self.assertEqual(self.sql("go_conversion", "SELECT version FROM migration"), "v1.0.0.0")
        self.assertEqual(self.sql("go_conversion", "SELECT count(*) FROM keep_data WHERE value::jsonb ? 'name'"), "1")
        source = service / "migrations/v1.0.1/v1.0.1.0.up.go"
        source.write_text(source.read_text() + "\n// modified after build\n")
        result = self.migrate(service, go=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source mismatch", result.stderr)

    def test_down_checksum_is_pinned_before_first_downgrade(self):
        service = self.service("pinned_reverse")
        (VersionFiles(service / "migrations") / "v1.0.1.sql").write_text("SELECT 1;")
        reverse = VersionFiles(service / "migrations", "down") / "v1.0.1.sql"
        reverse.write_text("SELECT 1;")
        self.success(self.migrate(service))
        reverse.write_text("DELETE FROM keep_data;")
        result = self.migrate(service, "v1.0.0", direction="down")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum", result.stderr)
        self.assertEqual(self.sql("pinned_reverse", "SELECT value FROM keep_data"), "keep")
        self.assertEqual(self.sql("pinned_reverse", "SELECT version FROM migration"), "v1.0.1.0")

    def test_manifest_drift_is_rejected_before_initial_install(self):
        service = self.service("manifest_drift")
        result = run(str(self.native), "checksums-write", str(service / "migrations/v1.0.0"))
        self.success(result)
        source = service / "migrations/v1.0.0/v1.0.0.0.up.sql"
        source.write_text(source.read_text() + "SELECT 2;")
        result = self.migrate(service, refresh=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksums.yaml mismatch", result.stderr)
        self.assertEqual(self.sql("postgres", "SELECT count(*) FROM pg_database WHERE datname='manifest_drift'"), "0")

    def test_release_steps_adopt_legacy_history_without_replay(self):
        service = self.service("release_steps")
        self.success(self.migrate(service))
        self.sql("release_steps", "UPDATE migration SET version='v1.0.0'; UPDATE migration_history SET version='v1.0.0'; UPDATE migration_audit SET version='v1.0.0'; UPDATE migration_sources SET version='v1.0.0';")
        step = service / "migrations/v1.0.0"
        (step / "v1.0.0.1.up.sql").write_text("INSERT INTO keep_data VALUES ('step1');")
        (step / "v1.0.0.1.down.sql").write_text("DELETE FROM keep_data WHERE value='step1';")
        self.success(self.migrate(service, "v1.0.0"))
        self.success(self.migrate(service))
        self.assertEqual(self.sql("release_steps", "SELECT version FROM migration"), "v1.0.0.1")
        self.assertEqual(self.sql("release_steps", "SELECT count(*) FROM keep_data"), "2")
        self.assertEqual(self.sql("release_steps", "SELECT count(*) FROM migration_history WHERE version='v1.0.0'"), "1")
        self.success(self.migrate(service, "v1.0.0.0", direction="down"))
        self.assertEqual(self.sql("release_steps", "SELECT value FROM keep_data"), "keep")
        self.success(self.migrate(service, "v1.0.0.1"))
        self.assertEqual(self.sql("release_steps", "SELECT count(*) FROM keep_data"), "2")

    def test_multiple_pending_steps_rollback_and_precise_target(self):
        service = self.service("step_failure")
        self.success(self.migrate(service))
        for n, sql in [(1, "INSERT INTO keep_data VALUES ('one');"), (2, "INSERT INTO keep_data VALUES ('two'); SELECT 1/0;")]:
            step = service / "migrations/v1.0.0"
            (step / f"v1.0.0.{n}.up.sql").write_text(sql)
            (step / f"v1.0.0.{n}.down.sql").write_text(f"DELETE FROM keep_data WHERE value='{'one' if n==1 else 'two'}';")
        self.assertNotEqual(self.migrate(service).returncode, 0)
        self.assertEqual(self.sql("step_failure", "SELECT value FROM keep_data"), "keep")
        self.assertEqual(self.sql("step_failure", "SELECT version FROM migration"), "v1.0.0.0")
        self.success(self.migrate(service, "v1.0.0.1"))
        self.assertEqual(self.sql("step_failure", "SELECT count(*) FROM keep_data"), "2")
        (service / "migrations/v1.0.0/v1.0.0.2.up.sql").write_text("INSERT INTO keep_data VALUES ('two');")
        self.success(self.migrate(service))
        self.assertEqual(self.sql("step_failure", "SELECT version FROM migration"), "v1.0.0.2")
        self.success(self.migrate(service, "v1.0.0.0", direction="down"))
        self.assertEqual(self.sql("step_failure", "SELECT value FROM keep_data"), "keep")

    def test_parallel_upgrade_runs_once(self):
        service = self.service("parallel")
        self.success(self.migrate(service))
        (VersionFiles(service / "migrations") / "v1.0.1.sql").write_text(
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

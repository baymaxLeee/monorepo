import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("invalid migration plans fail before connecting to a database", (t) => {
  const root = mkdtempSync(join(tmpdir(), "migration-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const versions = join(root, "canvas/migrations");
  const bin = join(root, "bin");
  mkdirSync(versions, { recursive: true });
  mkdirSync(bin);
  const marker = join(root, "connected");
  writeFileSync(join(bin, "docker"), '#!/bin/sh\ntouch "$CONNECTION_MARKER"\nexit 1\n', { mode: 0o755 });
  const run = (...args) =>
    spawnSync("bash", [resolve("scripts/db-migrate.sh"), join(root, "canvas"), ...args], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONNECTION_MARKER: marker },
      encoding: "utf8",
    });
  assert.notEqual(run().status, 0);
  mkdirSync(join(versions, "v1.0.0"), { recursive: true });
  writeFileSync(join(versions, "v1.0.0/v1.0.0.0.up.sql"), "SELECT 1;\n");
  assert.notEqual(run("v9.0.0").status, 0);
  assert.notEqual(run("v1.0.0'; SELECT 1").status, 0);
  mkdirSync(join(versions, "v01.0.1"), { recursive: true });
  writeFileSync(join(versions, "v01.0.1/v01.0.1.0.up.sql"), "SELECT 1;\n");
  const invalid = run();
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /invalid migration directory/);
  assert.equal(existsSync(marker), false);
});

test("Go migration catalog and registration contracts", () => {
  const result = spawnSync("go", ["test", "-race", "./..."], {
    cwd: resolve("scripts/dbmigrate"),
    env: { ...process.env, GOWORK: "off" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("repository migration checksum manifests match committed artifacts", () => {
  const result = spawnSync("bash", ["scripts/db-checksums.sh", "check"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

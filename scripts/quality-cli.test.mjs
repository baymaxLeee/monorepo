import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "quality-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backend = join(root, "apps/backend");
  mkdirSync(join(backend, "services/example/src"), { recursive: true });
  mkdirSync(join(root, "bin"));
  copyFileSync(join(source, "justfile"), join(root, "justfile"));
  copyFileSync(join(source, "apps/backend/justfile"), join(backend, "justfile"));
  const log = join(root, "calls.jsonl");
  writeFileSync(
    join(root, "bin/uv"),
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.QUALITY_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
if (args.includes("ruff") && args.includes(process.env.QUALITY_FAIL)) process.exit(7);
`,
    { mode: 0o755 },
  );
  return {
    root,
    backend,
    run(args, cwd = root, fail = "") {
      return spawnSync("just", args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, QUALITY_LOG: log, QUALITY_FAIL: fail },
      });
    },
    calls() {
      return readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    },
  };
}

test("scoped Python lint rejects format-only failures without rewriting source", (t) => {
  const f = fixture(t);
  const result = f.run(["lint", "example"], f.backend, "format");
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const calls = f.calls();
  assert.ok(calls.some(({ args }) => args.includes("check") && args.includes("ruff")));
  assert.ok(calls.some(({ args }) => args.includes("format") && args.includes("--check")));
  assert.ok(calls.every(({ args }) => !args.includes("--fix") && !args.includes("--write")));
});

test("scoped Python lint stops before typechecking on lint failures", (t) => {
  const f = fixture(t);
  const result = f.run(["lint", "example"], f.backend, "check");
  assert.notEqual(result.status, 0);
  assert.ok(f.calls().every(({ args }) => !args.includes("mypy")));
});

test("Python CLI forwards paths with spaces and native flags unchanged", (t) => {
  const f = fixture(t);
  const result = f.run(["lint-py", "--output-format", "json", "a folder/example.py"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls()[0].args.slice(-5), ["ruff", "check", "--output-format", "json", "a folder/example.py"]);
});

test("pre-commit CLI defaults to staged checks and forwards explicit all-files", (t) => {
  const f = fixture(t);
  assert.equal(f.run(["pre-commit"]).status, 0);
  assert.equal(f.run(["pre-commit", "--all-files"]).status, 0);
  const calls = f.calls();
  assert.deepEqual(calls[0].args.slice(-2), ["pre-commit", "run"]);
  assert.deepEqual(calls[1].args.slice(-3), ["pre-commit", "run", "--all-files"]);
});

function typescriptFixture(t) {
  const f = fixture(t);
  symlinkSync(join(source, "node_modules"), join(f.root, "node_modules"), "dir");
  for (const path of ["package.json", "oxlint.config.ts", "oxfmt.config.ts"]) {
    copyFileSync(join(source, path), join(f.root, path));
  }
  for (const path of ["apps/frontend/apps/example/src", "scripts"]) {
    mkdirSync(join(f.root, path), { recursive: true });
  }
  return f;
}

test("shared TS lint rejects the same defect in frontend, Node and repository scripts", (t) => {
  const f = typescriptFixture(t);
  for (const path of [
    "apps/frontend/apps/example/src/view.tsx",
    "apps/backend/services/example/src/main.cts",
    "scripts/example.mts",
  ]) {
    writeFileSync(join(f.root, path), "export var value = 1;\n");
  }
  const result = f.run(["lint-ts"]);
  assert.notEqual(result.status, 0);
  for (const path of ["view.tsx", "main.cts", "example.mts"]) {
    assert.ok((result.stdout + result.stderr).includes(path), result.stdout + result.stderr);
  }
});

test("shared TS format gate covers both mts and cts without rewriting them", (t) => {
  const f = typescriptFixture(t);
  const paths = ["scripts/example.mts", "apps/backend/services/example/src/main.cts"];
  for (const path of paths) writeFileSync(join(f.root, path), "export const value={key:1}\n");
  const result = f.run(["lint-ts"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Checking formatting/);
  for (const path of paths) {
    assert.ok((result.stdout + result.stderr).includes(path), result.stdout + result.stderr);
    assert.equal(readFileSync(join(f.root, path), "utf8"), "export const value={key:1}\n");
  }
});

test("browser source rejects Node builtins across import forms", (t) => {
  const f = typescriptFixture(t);
  const cases = {
    "static.ts": 'import fs from "fs"; export { fs };',
    "prefix.ts": 'import fs from "node:fs"; export { fs };',
    "dynamic.ts": 'export const fs = import("node:fs");',
    "subpath.ts": 'export * from "fs/promises";',
    "types.ts": 'export type { Stats } from "node:fs";',
    "commonjs.js": 'const fs = require("fs"); console.log(fs);',
  };
  for (const [name, content] of Object.entries(cases)) {
    writeFileSync(join(f.root, "apps/frontend/apps/example/src", name), content + "\n");
  }
  mkdirSync(join(f.root, "apps/frontend/packages/example"), { recursive: true });
  writeFileSync(join(f.root, "apps/frontend/packages/example/index.ts"), 'export * from "node:fs";\n');
  const result = spawnSync("pnpm", ["lint:ts", "apps/frontend"], { cwd: f.root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  for (const name of Object.keys(cases)) {
    assert.ok((result.stdout + result.stderr).includes(name), result.stdout + result.stderr);
  }
  assert.match(result.stdout + result.stderr, /packages\/example\/index.ts/);
});

test("Node imports remain valid in backend, build config, scripts and frontend tests", (t) => {
  const f = typescriptFixture(t);
  for (const path of [
    "apps/backend/services/example/src/main.ts",
    "apps/frontend/apps/example/rspack.config.mjs",
    "apps/frontend/packages/build-config/loader.mjs",
    "apps/frontend/packages/example/orval.config.ts",
    "apps/frontend/packages/example/scripts/generate.ts",
    "apps/frontend/apps/example/src/view.spec.ts",
    "apps/frontend/apps/example/src/__tests__/helper.ts",
    "apps/frontend/packages/example/test/helper.ts",
    "apps/frontend/test/setup.ts",
    "scripts/example.mts",
  ]) {
    mkdirSync(dirname(join(f.root, path)), { recursive: true });
    writeFileSync(join(f.root, path), 'import fs from "node:fs"; console.log(fs, process.pid);\n');
  }
  const result = spawnSync("pnpm", ["lint:ts", "apps", "scripts"], { cwd: f.root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("browser Node globals and Node JavaScript DOM globals are rejected", (t) => {
  const f = typescriptFixture(t);
  writeFileSync(
    join(f.root, "apps/frontend/apps/example/src/globals.ts"),
    "console.log(process.pid, Buffer.alloc(1));\n",
  );
  writeFileSync(join(f.root, "scripts/dom.mjs"), "console.log(window.location, document.title);\n");
  const result = spawnSync("pnpm", ["lint:ts", "apps", "scripts"], { cwd: f.root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  for (const name of ["globals.ts", "dom.mjs"]) {
    assert.ok((result.stdout + result.stderr).includes(name), result.stdout + result.stderr);
  }
});

test("browser globals and locally declared bundler constants remain valid", (t) => {
  const f = typescriptFixture(t);
  writeFileSync(
    join(f.root, "apps/frontend/apps/example/src/browser.ts"),
    "declare const process: { env: { API_BASE_URL: string } };\nexport const title = document.title;\nexport const url = process.env.API_BASE_URL;\n",
  );
  const result = spawnSync("pnpm", ["lint:ts", "apps/frontend"], { cwd: f.root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("browser UUID access must use the HTTP-compatible shared helper", (t) => {
  const f = typescriptFixture(t);
  const cases = {
    "direct.ts": "export const id = crypto.randomUUID();",
    "global.ts": "export const id = globalThis.crypto.randomUUID();",
    "window.ts": "export const id = window.crypto.randomUUID();",
    "computed.ts": 'export const id = crypto["randomUUID"]();',
    "alias.ts": "const c = globalThis.crypto; export const id = c.randomUUID();",
    "destructure.ts": "export const { randomUUID } = crypto;",
  };
  for (const [name, content] of Object.entries(cases)) {
    writeFileSync(join(f.root, "apps/frontend/apps/example/src", name), content + "\n");
  }
  const result = spawnSync("pnpm", ["lint:ts", "apps/frontend"], { cwd: f.root, encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  for (const name of Object.keys(cases)) {
    assert.ok((result.stdout + result.stderr).includes(name), result.stdout + result.stderr);
  }
  assert.match(result.stdout + result.stderr, /randomId/);
});

test("UUID access remains available in Node and capability tests", (t) => {
  const f = typescriptFixture(t);
  for (const path of ["scripts/id.mts", "apps/frontend/apps/example/src/id.test.ts"]) {
    writeFileSync(join(f.root, path), "export const id = crypto.randomUUID();\n");
  }
  writeFileSync(
    join(f.root, "apps/frontend/apps/example/src/id.ts"),
    'import { randomId } from "@repo/shared"; export const id = randomId();\n',
  );
  const result = spawnSync("pnpm", ["lint:ts", "apps/frontend", "scripts"], { cwd: f.root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

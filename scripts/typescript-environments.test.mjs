import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { globSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const frontend = join(root, "apps/frontend");
const compiler = join(frontend, "node_modules/@typescript/native/bin/tsc");

function project(t, profile) {
  const directory = mkdtempSync(join(tmpdir(), "typescript-environment-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  symlinkSync(join(frontend, "node_modules"), join(directory, "node_modules"), "dir");
  mkdirSync(join(directory, "src"));
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      extends: join(root, profile),
      compilerOptions: { noEmit: true, rootDir: join(directory, "src") },
      files: ["src/probe.ts"],
      include: [],
      exclude: [],
    }),
  );
  return (code) => {
    writeFileSync(join(directory, "src/probe.ts"), code + "\n");
    const result = spawnSync(process.execPath, [compiler, "-p", join(directory, "tsconfig.json")], {
      cwd: directory,
      encoding: "utf8",
    });
    return { status: result.status, output: result.stdout + result.stderr };
  };
}

const nodeProfiles = [
  ...globSync("apps/backend/{services,libs}/*/tsconfig.json", { cwd: root }),
  "apps/frontend/packages/shared/tsconfig.build.json",
];

for (const profile of nodeProfiles) {
  test(`${profile} rejects DOM but keeps native Node web APIs`, (t) => {
    const compile = project(t, profile);
    const invalid = compile("export const title = document.title; export const location = window.location;");
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.output, /Cannot find name 'document'/);
    assert.match(invalid.output, /Cannot find name 'window'/);
    const valid = compile(
      'export const pid = process.pid; export const response: Response = new Response(new Blob(["hello"])); export const stream = new ReadableStream<Uint8Array>();',
    );
    assert.equal(valid.status, 0, valid.output);
  });
}

test("browser types expose DOM without ambient Node globals", (t) => {
  const compile = project(t, "apps/frontend/packages/shared/typescript-config.json");
  const invalid = compile("export const pid = process.pid; export const bytes = Buffer.alloc(1);");
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.output, /Cannot find name 'process'/);
  assert.match(invalid.output, /Cannot find name 'Buffer'/);
  const valid = compile("export const title = document.title; export const location = window.location;");
  assert.equal(valid.status, 0, valid.output);
});

test("jsdom test profile exposes both Node and DOM APIs", (t) => {
  const compile = project(t, "apps/frontend/tsconfig.test.json");
  const result = compile("export const title = document.title; export const pid = process.pid;");
  assert.equal(result.status, 0, result.output);
});

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { backendArchitectureErrors } from "./backend-architecture.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "backend-architecture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  return { root, write };
}

test("rejects inward layers importing concrete outer adapters", (t) => {
  const { root, write } = fixture(t);
  write(
    "apps/backend/services/demo/internal/application/service.go",
    'package application\nimport "example.com/demo/internal/infrastructure/persistence"\n',
  );
  assert.match(backendArchitectureErrors(root).join("\n"), /application must not import outer infrastructure/);
});

test("accepts adapters implementing application-owned ports", (t) => {
  const { root, write } = fixture(t);
  write("apps/backend/services/demo/internal/application/ports.go", "package application\n");
  write(
    "apps/backend/services/demo/internal/infrastructure/persistence/repository.go",
    'package persistence\nimport "example.com/demo/internal/application"\n',
  );
  write(
    "apps/backend/services/demo/cmd/server/main.go",
    'package main\nimport "example.com/demo/internal/bootstrap"\n',
  );
  assert.deepEqual(backendArchitectureErrors(root), []);
});

test("requires architecture exceptions to stay exact and in use", (t) => {
  const { root, write } = fixture(t);
  write("apps/backend/services/demo/internal/application/service.go", "package application\n");
  write(
    "apps/backend/architecture-import-exceptions.json",
    JSON.stringify([
      {
        source: "apps/backend/services/demo/internal/application/service.go",
        target: "example.com/demo/internal/infrastructure/persistence",
      },
    ]),
  );
  assert.match(backendArchitectureErrors(root).join("\n"), /stale backend architecture exception/);
});

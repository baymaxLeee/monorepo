import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.join(import.meta.dirname, "prepare-admin-server.mjs");

test("prepares the complete public Admin Go server contract", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "admin-server-"));
  try {
    const output = path.join(directory, "admin-server.json");
    execFileSync(process.execPath, [script, "--target", "admin-server", "--output", output]);
    const document = JSON.parse(readFileSync(output, "utf8"));
    const canonical = readFileSync(path.join(import.meta.dirname, "../openapi/admin-server.json"), "utf8");
    const operation = document.paths["/skills"].get;
    assert.equal(document.info.title, "Admin Service");
    assert.equal(document["x-canonical-sha256"], createHash("sha256").update(canonical).digest("hex"));
    assert.equal(operation.operationId, "list_skills");
    assert.equal(operation["x-original-operation-id"], "list_skills");
    assert.equal(
      Object.keys(document.paths).some((value) => value.startsWith("/internal")),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

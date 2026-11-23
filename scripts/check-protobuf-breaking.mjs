import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_REPLACEMENT = "FILE_REPLACEMENT";

export function parseAgainst(value) {
  const match = /^\.git#ref=([^,]+),subdir=(.+)$/.exec(value);
  if (!match) throw new Error(`unsupported Buf baseline: ${value}`);
  return { ref: match[1], subdir: match[2].replace(/\/$/, "") };
}

export function unexpectedDiagnostics(diagnostics, allowlist, baselineHashes) {
  const fileReplacements = allowlist.filter(
    (entry) => entry.type === FILE_REPLACEMENT && baselineHashes.get(entry.baselinePath) === entry.baselineSha256,
  );
  const remaining = [...allowlist];
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.path && fileReplacements.some((entry) => diagnostic.path.endsWith(entry.baselinePath))) {
      return false;
    }
    const index = remaining.findIndex(
      (entry) =>
        entry.type !== FILE_REPLACEMENT &&
        baselineHashes.get(entry.baselinePath) === entry.baselineSha256 &&
        diagnostic.type === entry.type &&
        diagnostic.message === entry.message &&
        (!diagnostic.path || diagnostic.path.endsWith(entry.baselinePath)),
    );
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

export function checkBreaking(against, root = ROOT, spawn = spawnSync) {
  const { ref, subdir } = parseAgainst(against);
  const allowlist = JSON.parse(readFileSync(resolve(root, "schemas/breaking-allowlist.json"), "utf8"));
  const baselineHashes = new Map();
  for (const { baselinePath } of allowlist) {
    if (baselineHashes.has(baselinePath)) continue;
    const result = spawn("git", ["show", `${ref}:${subdir}/${baselinePath}`], {
      cwd: root,
      encoding: null,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status === 0) baselineHashes.set(baselinePath, createHash("sha256").update(result.stdout).digest("hex"));
  }

  const result = spawn("buf", ["breaking", "schemas/proto", "--against", against, "--error-format=json"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status === 0) return 0;
  if (result.error) throw result.error;
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  let diagnostics;
  try {
    diagnostics = lines.map((line) => JSON.parse(line));
  } catch {
    process.stderr.write(result.stderr || result.stdout);
    return result.status ?? 1;
  }
  const unexpected = unexpectedDiagnostics(diagnostics, allowlist, baselineHashes);
  if (unexpected.length > 0) {
    for (const diagnostic of unexpected) process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    return result.status ?? 1;
  }
  process.stdout.write(`Accepted ${diagnostics.length} explicitly approved protobuf breaking changes.\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const against = process.argv[2];
    if (!against) throw new Error("usage: check-protobuf-breaking.mjs <buf-against>");
    process.exitCode = checkBreaking(against);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

// The real Electron and sandbox suites must test one completed bundle. Building
// in an individual suite races the other workers and fails on a clean checkout.
export default async function setup() {
  await promisify(execFile)(process.execPath, ["scripts/build.mjs"], {
    cwd: resolve(import.meta.dirname, ".."),
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

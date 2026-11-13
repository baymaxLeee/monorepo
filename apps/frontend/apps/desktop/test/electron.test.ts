import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")(
  "actual Electron main, preload, utility Agent and Seatbelt file helper work end to end",
  async () => {
    const require = createRequire(import.meta.url);
    const executable: string = require("electron");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(executable, [resolve(import.meta.dirname, "electron-smoke.mjs")], {
      env,
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(result.stdout).toContain("ELECTRON_LOCAL_E2E_PASS");
  },
  50_000,
);

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import electron from "electron";
await import("./build.mjs");
const root = fileURLToPath(new URL("..", import.meta.url));
const child = spawn(electron, [root, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));

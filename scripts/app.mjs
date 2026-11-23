#!/usr/bin/env node
import { spawn } from "node:child_process";

const LOCAL_URL = "http://localhost:3000/";
const VPS_URL = "http://124.222.245.5:8080/";
const mode = process.argv[2] ?? "local";

if (process.argv.length > 3 || !["local", "vps"].includes(mode)) {
  console.error("Usage: just app [local|vps]");
  process.exit(2);
}

const url = mode === "local" ? LOCAL_URL : (process.env.DESKTOP_PLATFORM_URL ?? VPS_URL);
let parsed;
try {
  parsed = new URL(url);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error("expected a Platform root URL without credentials, query, or fragment");
} catch (error) {
  console.error(`Invalid Platform URL: ${error.message}`);
  process.exit(2);
}

let stack;
let stackDone;
let desktop;
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  desktop?.kill("SIGTERM");
  // `just dev` may exec overmind, mprocs, or the shell fallback. All descendants
  // belong to this process group so closing Electron also closes that dev stack.
  if (stack?.pid) {
    try {
      process.kill(-stack.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);

function completion(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: 1, error }));
    child.once("exit", (code, signal) =>
      resolve({ code: code ?? (signal ? 128 + (signal === "SIGINT" ? 2 : 15) : 1) }),
    );
  });
}

async function ready() {
  const deadline = Date.now() + 120_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(LOCAL_URL, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      /* The dev stack is still starting. */
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }
  throw new Error(stopping ? "App startup interrupted" : "Platform did not become ready within 120 seconds");
}

try {
  if (mode === "local") {
    console.log("→ Starting local Web stack");
    stack = spawn("just", ["dev"], { stdio: "inherit", detached: true });
    stackDone = completion(stack);
    await Promise.race([
      ready(),
      stackDone.then(({ code, error }) => {
        throw error ?? new Error(`just dev exited with status ${code}`);
      }),
    ]);
    if (stopping) throw new Error("App startup interrupted");
  }

  console.log(`→ Starting Electron with ${url}`);
  const args = ["--dir", "apps/frontend/apps/desktop", "launch", `--platform-url=${url}`];
  if (mode === "vps" && parsed.protocol === "http:") args.push("--allow-http");
  desktop = spawn("pnpm", args, { stdio: "inherit" });
  const result = await Promise.race([
    completion(desktop),
    ...(stackDone
      ? [
          stackDone.then(({ code, error }) => {
            throw error ?? new Error(`just dev exited with status ${code}`);
          }),
        ]
      : []),
  ]);
  if (result.error) throw result.error;
  process.exitCode = stopping ? 130 : result.code;
} catch (error) {
  if (!stopping) console.error(`✗ ${error.message}`);
  process.exitCode = stopping ? 130 : 1;
} finally {
  stop();
}

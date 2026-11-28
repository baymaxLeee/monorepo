#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
let stopPromise;
const overmindSocket = resolve(".overmind.sock");
const overmindSocketPreexisted = existsSync(overmindSocket);

function signalStack(signal) {
  if (!stack?.pid) return;
  try {
    process.kill(-stack.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

async function waitFor(promise, milliseconds) {
  const timeout = Symbol("timeout");
  return (await Promise.race([promise, delay(milliseconds).then(() => timeout)])) !== timeout;
}

async function stopOwnedOvermind() {
  if (overmindSocketPreexisted || !existsSync(overmindSocket)) return;
  const quit = spawn("overmind", ["quit", "-s", overmindSocket], { stdio: "ignore" });
  const quitDone = completion(quit);
  if (!(await waitFor(quitDone, 5_000))) {
    quit.kill("SIGKILL");
    await quitDone;
  }
}

async function stopAll() {
  stopping = true;
  desktop?.kill("SIGTERM");
  // Overmind owns a detached tmux server, so signalling only the `just dev`
  // process group leaves every pane alive. Ask an Overmind instance created by
  // this app to quit before falling back to process-group termination. mprocs and
  // the shell fallback remain owned by the original detached process group.
  await stopOwnedOvermind();
  signalStack("SIGTERM");
  if (stackDone && !(await waitFor(stackDone, 5_000))) signalStack("SIGKILL");
}

function stop() {
  stopPromise ??= stopAll();
  return stopPromise;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void stop();
  });
}

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
  await stop();
}

import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverProjects } from "./repository.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patterns = {
  go: ["**/*_test.go"],
  python: ["src/**/test_*.py", "src/**/*_test.py", "tests/**/test_*.py", "tests/**/*_test.py"],
  node: ["src/**/*.test.ts", "test/**/*.test.ts"],
  frontend: ["src/**/*.{test,spec}.{ts,tsx,js,jsx,mjs}", "test/**/*.{test,spec}.{ts,tsx,js,jsx,mjs}"],
};

export function discoverTargets(root = ROOT) {
  const targets = discoverProjects(root).map((project) => ({
    ...project,
    files: globSync(patterns[project.runtime], {
      cwd: project.dir,
      exclude: ["**/node_modules/**", "**/.venv/**", "**/vendor/**"],
    }),
  }));
  targets.push({ id: "tooling", runtime: "tooling", dir: root, files: globSync("scripts/*.test.mjs", { cwd: root }) });
  return targets;
}

export function selectTargets(targets, selection) {
  if (selection === "all") return targets;
  const selected = targets.filter(
    (target) =>
      target.id === selection || (["backend", "frontend"].includes(selection) && target.id.startsWith(`${selection}/`)),
  );
  if (!selected.length) throw new Error(`Unknown test target: ${selection}. Run just test-list.`);
  return selected;
}

export function commandFor(target, root, args) {
  switch (target.runtime) {
    case "go":
      return ["go", "test", "-race", "./...", ...args];
    case "python":
      return [
        "uv",
        "run",
        "--project",
        join(root, "apps/backend"),
        "pytest",
        "-c",
        join(target.dir, "pyproject.toml"),
        ...args,
      ];
    case "node":
      return ["pnpm", "test", ...args];
    case "frontend":
      return ["pnpm", "--dir", join(root, "apps/frontend"), "test", "--project", target.packageName, ...args];
    case "tooling":
      return ["node", "--test", ...args, ...target.files];
    default:
      throw new Error(`Unknown runtime: ${target.runtime}`);
  }
}

export function runTargets(targets, root = ROOT, args = [], spawn = spawnSync, aggregateFrontend = false) {
  let failed = false;
  const frontend = [];
  for (const target of targets) {
    if (!target.files.length) {
      const allowed = aggregateFrontend && target.runtime === "frontend";
      console.error(`${allowed ? "UNTESTED" : "FAIL"} ${target.id}: no test files found`);
      if (!allowed) failed = true;
      continue;
    }
    if (target.runtime === "frontend") {
      frontend.push(target);
      continue;
    }
    const [command, ...commandArgs] = commandFor(target, root, args);
    console.log(`\nTesting ${target.id}`);
    const result = spawn(command, commandArgs, { cwd: target.dir, stdio: "inherit" });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failed = true;
  }
  if (frontend.length) {
    console.log(`\nTesting ${frontend.map((p) => p.id).join(", ")}`);
    const result = spawn("pnpm", ["test", ...frontend.flatMap((p) => ["--project", p.packageName]), ...args], {
      cwd: join(root, "apps/frontend"),
      stdio: "inherit",
    });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failed = true;
  } else if (aggregateFrontend && targets.some((p) => p.runtime === "frontend")) {
    failed = true;
  }
  return failed ? 1 : 0;
}

export function runSelection(selection, root = ROOT, args = []) {
  const targets = discoverTargets(root);
  if (selection === "--list") {
    for (const target of targets)
      console.log(
        `${target.id}\t${target.runtime}\t${target.files.length} test files${target.files.length ? "" : " (NO TESTS)"}`,
      );
    return 0;
  }
  return runSelections([selection.replace(/\/$/, "")], root, args, targets);
}

export function runSelections(selections, root = ROOT, args = [], targets = discoverTargets(root), spawn = spawnSync) {
  const selected = [
    ...new Map(selections.flatMap((selection) => selectTargets(targets, selection)).map((p) => [p.id, p])).values(),
  ];
  if (args.length && selected.length !== 1)
    throw new Error("Runner arguments require a single target. Run just test-list.");
  return runTargets(selected, root, args, spawn, selections.includes("all") || selections.includes("frontend"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [selection = "all", ...args] = process.argv.slice(2);
    process.exitCode = runSelection(selection, ROOT, args);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

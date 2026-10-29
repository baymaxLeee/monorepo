import { spawnSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patterns = {
  go: ["**/*_test.go"],
  python: ["src/**/test_*.py", "src/**/*_test.py", "tests/**/test_*.py", "tests/**/*_test.py"],
  node: ["src/**/*.test.ts", "test/**/*.test.ts"],
  frontend: ["src/**/*.{test,spec}.{ts,tsx,js,jsx,mjs}", "test/**/*.{test,spec}.{ts,tsx,js,jsx,mjs}"],
};

export function discoverTargets(root = ROOT) {
  const targets = [];
  for (const area of ["backend", "frontend"]) {
    for (const kind of area === "backend" ? ["services", "libs"] : ["apps", "packages"]) {
      for (const relative of globSync(`apps/${area}/${kind}/*`, { cwd: root }).sort()) {
        const dir = join(root, relative);
        if (area === "frontend" && !existsSync(join(dir, "package.json"))) continue;
        const name =
          area === "frontend"
            ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name
            : relative.split("/").at(-1);
        const runtime =
          area === "frontend"
            ? "frontend"
            : existsSync(join(dir, "go.mod"))
              ? "go"
              : existsSync(join(dir, "pyproject.toml"))
                ? "python"
                : existsSync(join(dir, "package.json"))
                  ? "node"
                  : null;
        if (!runtime) continue;
        targets.push({
          id: `${area}/${name}`,
          dir,
          runtime,
          packageName: runtime === "frontend" ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name : null,
          files: globSync(patterns[runtime], {
            cwd: dir,
            exclude: ["**/node_modules/**", "**/.venv/**", "**/vendor/**"],
          }),
        });
      }
    }
  }
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

export function runTargets(targets, root = ROOT, args = [], spawn = spawnSync) {
  let failed = false;
  for (const target of targets) {
    if (!target.files.length) {
      console.error(`FAIL ${target.id}: no test files found`);
      failed = true;
      continue;
    }
    const [command, ...commandArgs] = commandFor(target, root, args);
    console.log(`\nTesting ${target.id}`);
    const result = spawn(command, commandArgs, { cwd: target.dir, stdio: "inherit" });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

function main() {
  const [selection = "all", ...args] = process.argv.slice(2);
  const targets = discoverTargets();
  if (selection === "--list") {
    for (const target of targets)
      console.log(
        `${target.id}\t${target.runtime}\t${target.files.length} test files${target.files.length ? "" : " (NO TESTS)"}`,
      );
    return 0;
  }
  const selected = selectTargets(targets, selection.replace(/\/$/, ""));
  if (args.length && selected.length !== 1)
    throw new Error("Runner arguments require a single target. Run just test-list.");
  // Vitest owns frontend project scheduling; untested projects remain visible in test-list.
  const frontend = selected.filter((target) => target.runtime === "frontend");
  let status = 0;
  if (frontend.length > 1) {
    const result = spawnSync("pnpm", ["test"], { cwd: join(ROOT, "apps/frontend"), stdio: "inherit" });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) status = 1;
  }
  return Math.max(
    status,
    runTargets(
      selected.filter((target) => target.runtime !== "frontend" || frontend.length === 1),
      ROOT,
      args,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { imagePlan } from "./image-plan.mjs";
import { consumersOf, discoverProjects, ownerOf } from "./repository.mjs";
import { changedFiles } from "./test-affected.mjs";
import { discoverTargets } from "./test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
  return result.stdout.trim();
}
function snapshot(root) {
  const hash = createHash("sha256");
  hash.update(git(root, "rev-parse", "HEAD"));
  hash.update(git(root, "diff", "--binary", "HEAD", "--"));
  hash.update(git(root, "diff", "--cached", "--binary", "--"));
  for (const path of git(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean)) {
    hash.update(path);
    hash.update(readFileSync(resolve(root, path)));
  }
  return hash.digest("hex");
}
function fullCodePlan(base, files) {
  const forceAll = files === null;
  const paths = files ?? [];
  if (paths.length && paths.every((path) => path.endsWith(".md"))) {
    return [
      ["repository", "just", "check-repo"],
      ["tooling-tests", "just", "test", "tooling"],
    ];
  }
  const steps = [
    ["root-dependencies", "pnpm", "install", "--frozen-lockfile"],
    ["frontend-dependencies", "pnpm", "--dir", "apps/frontend", "install", "--frozen-lockfile"],
    ["backend-dependencies", "pnpm", "--dir", "apps/backend", "install", "--frozen-lockfile"],
    ["python-dependencies", "uv", "sync", "--project", "apps/backend", "--all-packages", "--locked"],
    ["go-module-consistency", "just", "check-go-modules"],
    ["lint-format-types", "just", "lint"],
  ];
  // These executable tooling changes already select every scope in test-affected.
  // Use the required full runner once rather than executing both equivalent plans.
  const fullTests = forceAll || paths.some((p) => (p.startsWith("scripts/") && !p.endsWith(".md")) || p === "justfile");
  steps.push(fullTests ? ["all-tests", "just", "test"] : ["affected-tests", "just", "test-affected", base, "all"]);
  steps.push(["contracts", "just", "sync-check"], ["build", "just", "build"]);
  if (forceAll || paths.some((p) => /migrations\/|scripts\/db|infra\/single-vps/.test(p))) {
    steps.push(["migration-integration", "just", "test-db-migrations"]);
  }
  if (forceAll || paths.some((path) => path.startsWith("schemas/proto/"))) {
    steps.push(
      ["protobuf-lint", "buf", "lint", "schemas/proto"],
      ["protobuf-format", "buf", "format", "--diff", "--exit-code", "schemas/proto"],
    );
    if (!forceAll)
      steps.push([
        "protobuf-breaking",
        "buf",
        "breaking",
        "schemas/proto",
        "--against",
        `.git#ref=${base},subdir=schemas/proto`,
      ]);
  }
  return steps;
}
function isDocumentation(path) {
  return path.endsWith(".md") || /(^|\/)AGENTS(?:\.override)?\.md$/.test(path);
}
function isTooling(path) {
  return (
    isDocumentation(path) ||
    path.startsWith("scripts/") ||
    path.startsWith(".agents/") ||
    path.startsWith(".github/") ||
    ["justfile", "mise.toml"].includes(path)
  );
}
function contractOwners(path) {
  if (
    path === "schemas/streaming/chat-ui.ts" ||
    path === "schemas/streaming/chat-uimessage-stream.md" ||
    path === "schemas/codegen/generate-chat-ui.mjs"
  )
    return ["backend/chat", "frontend/@repo/ai-elements"];
  if (path === "schemas/openapi/chat-server.json") return ["backend/chat", "frontend/chat"];
  return [];
}
function toolingCodePlan(files) {
  const executable = files.filter((path) => !isDocumentation(path));
  const lintFiles = executable.filter((path) => /\.[cm]?[jt]sx?$/.test(path));
  const formatFiles = executable.filter((path) => /\.(?:jsonc?|[cm]?[jt]sx?)$/.test(path));
  const steps = [
    ["repository", "just", "check-repo"],
    ["frontend-dependencies", "pnpm", "--dir", "apps/frontend", "install", "--frozen-lockfile"],
  ];
  if (lintFiles.length || formatFiles.length) steps.push(["root-dependencies", "pnpm", "install", "--frozen-lockfile"]);
  if (lintFiles.length) steps.push(["tooling-lint", "pnpm", "lint:ts", ...lintFiles]);
  if (formatFiles.length) steps.push(["tooling-format", "pnpm", "exec", "oxfmt", "--check", ...formatFiles]);
  steps.push(["tooling-tests", "just", "test", "tooling"]);
  return steps;
}
export function codePlan(base, files, root = ROOT) {
  if (files === null) return fullCodePlan(base, files);
  if (files.length && files.every(isTooling)) return toolingCodePlan(files);
  const projects = discoverProjects(root);
  const executableFiles = files.filter((path) => !isDocumentation(path));
  const changes = executableFiles.map((path) => ({
    path,
    area: path.startsWith("apps/frontend/") ? "frontend" : path.startsWith("apps/backend/") ? "backend" : null,
    owner: ownerOf(projects, root, path),
    contractOwners: contractOwners(path),
  }));
  if (changes.some(({ area, contractOwners: owners }) => !area && !owners.length)) return fullCodePlan(base, files);

  const broadAreas = new Set(
    changes
      .filter(
        ({ owner, contractOwners: owners }) =>
          !owners.length && (!owner || (owner.area === "backend" && owner.kind === "libs" && owner.runtime !== "node")),
      )
      .map(({ area }) => area)
      .filter(Boolean),
  );
  for (const project of projects) {
    if (project.dependencyErrors?.length) broadAreas.add(project.area);
  }
  const affectedIds = new Set(
    consumersOf(
      projects,
      changes.flatMap(({ owner, contractOwners: owners }) => (owner ? [owner.id] : owners)),
    ),
  );
  for (const { id, area } of projects) {
    if (broadAreas.has(area)) affectedIds.add(id);
  }
  const affected = projects.filter(({ id }) => affectedIds.has(id));
  const frontend = affected.filter(({ area }) => area === "frontend");
  const backend = affected.filter(({ area }) => area === "backend");
  const nodeBackend = backend.filter(({ runtime }) => runtime === "node");
  const pythonBackend = backend.filter(({ runtime }) => runtime === "python");
  const goBackend = backend.filter(({ runtime }) => runtime === "go");
  const steps = [];

  if (files.some(isDocumentation)) steps.push(["repository", "just", "check-repo"]);

  if (frontend.length || nodeBackend.length) steps.push(["root-dependencies", "pnpm", "install", "--frozen-lockfile"]);
  if (frontend.length)
    steps.push(["frontend-dependencies", "pnpm", "--dir", "apps/frontend", "install", "--frozen-lockfile"]);
  if (nodeBackend.length)
    steps.push(["backend-dependencies", "pnpm", "--dir", "apps/backend", "install", "--frozen-lockfile"]);
  if (pythonBackend.length)
    steps.push(["python-dependencies", "uv", "sync", "--project", "apps/backend", "--all-packages", "--locked"]);

  if (frontend.length) {
    const changed = changes
      .filter(({ area, path }) => area === "frontend" && existsSync(resolve(root, path)))
      .map(({ path }) => path);
    const lintFiles = changed.filter((path) => /\.[cm]?[jt]sx?$/.test(path));
    const formatFiles = changed.filter((path) => /\.(?:css|jsonc?|[cm]?[jt]sx?)$/.test(path));
    const uiFiles = changed.filter((path) => /\.(?:css|tsx?)$/.test(path));
    if (lintFiles.length) steps.push(["frontend-lint", "pnpm", "lint:ts", ...lintFiles]);
    if (formatFiles.length) steps.push(["frontend-format", "pnpm", "exec", "oxfmt", "--check", ...formatFiles]);
    steps.push([
      "frontend-types",
      "pnpm",
      "--dir",
      "apps/frontend",
      "exec",
      "turbo",
      "run",
      "typecheck",
      ...frontend.flatMap(({ packageName }) => ["--filter", packageName]),
    ]);
    if (uiFiles.length)
      steps.push(["frontend-ui-contracts", "pnpm", "lint:ui-contracts", ...frontend.map(({ path }) => path)]);
    steps.push([
      "frontend-boundaries",
      "pnpm",
      "--dir",
      "apps/frontend",
      "exec",
      "turbo",
      "boundaries",
      ...frontend.flatMap(({ packageName }) => ["--filter", packageName]),
    ]);
  }
  if (nodeBackend.length) {
    const changed = changes
      .filter(
        ({ area, owner, path }) => area === "backend" && owner?.runtime === "node" && existsSync(resolve(root, path)),
      )
      .map(({ path }) => path);
    const lintFiles = changed.filter((path) => /\.[cm]?[jt]sx?$/.test(path));
    const formatFiles = changed.filter((path) => /\.(?:jsonc?|[cm]?[jt]sx?)$/.test(path));
    if (lintFiles.length) steps.push(["backend-node-lint", "pnpm", "lint:ts", ...lintFiles]);
    if (formatFiles.length) steps.push(["backend-node-format", "pnpm", "exec", "oxfmt", "--check", ...formatFiles]);
    steps.push(...nodeBackend.map(({ id, path }) => [`type-${id}`, "pnpm", "--dir", path, "run", "typecheck"]));
  }
  if (pythonBackend.length) {
    const changed = changes
      .filter(
        ({ area, owner, path }) =>
          area === "backend" && owner?.runtime === "python" && path.endsWith(".py") && existsSync(resolve(root, path)),
      )
      .map(({ path }) => path);
    if (changed.length) {
      steps.push(["backend-python-lint", "just", "lint-py", ...changed]);
      steps.push(["backend-python-format", "just", "fmt-py", "--check", ...changed]);
    }
    steps.push(...pythonBackend.map(({ id, path }) => [`type-${id}`, "uv", "run", "--directory", path, "mypy", "."]));
  }
  for (const { id, path } of goBackend) {
    steps.push(
      [`lint-${id}`, "go", "-C", path, "vet", "./..."],
      [`module-${id}`, "go", "-C", path, "mod", "tidy", "-diff"],
    );
  }

  const targets = new Map(discoverTargets(root).map((target) => [target.id, target]));
  const frontendTests = frontend.filter(({ id }) => targets.get(id)?.files.length);
  if (frontendTests.length)
    steps.push([
      "frontend-tests",
      "pnpm",
      "--dir",
      "apps/frontend",
      "test",
      ...frontendTests.flatMap(({ packageName }) => ["--project", packageName]),
    ]);
  for (const { id } of backend.filter(({ id }) => targets.get(id)?.files.length)) {
    steps.push([`test-${id}`, "just", "test", id]);
  }
  if (changes.some(({ contractOwners: owners }) => owners.length)) steps.push(["contracts", "just", "sync-check"]);
  for (const { area, id, path } of affected.filter(({ kind }) => kind === "apps" || kind === "services")) {
    const name = path.split("/").at(-1);
    steps.push([
      `build-${id}`,
      "just",
      "--justfile",
      `apps/${area}/justfile`,
      "--working-directory",
      `apps/${area}`,
      "build",
      name,
    ]);
  }
  return steps;
}
export function localImagePlatform(arch = process.arch) {
  return arch === "arm64" ? "linux/arm64" : "linux/amd64";
}
export function imageSteps(files, imagePlatform = localImagePlatform()) {
  const steps = [];
  for (const image of imagePlan(files).buildMatrix.include) {
    steps.push([
      `image-${image.service}`,
      "docker",
      "buildx",
      "build",
      "--platform",
      imagePlatform,
      "--load",
      "--tag",
      `local/agent-ci-${image.service}:check`,
      "--file",
      image.dockerfile,
      image.context,
    ]);
  }
  return steps;
}
export function plan(base) {
  return [["code", "just", "ci-code", base]];
}
export function releasePlan(base, files, imagePlatform = localImagePlatform()) {
  return [...plan(base), ...imageSteps(files, imagePlatform)];
}
async function executeDirect(root, step) {
  const [name, command, ...args] = step;
  console.log(`\n[${name}] ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, CI: "true" }, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} failed`);
}
export async function runCode(root, baseRef) {
  if (baseRef === "all" || /^0+$/.test(baseRef)) {
    for (const step of codePlan(git(root, "rev-parse", "HEAD"), null, root)) await executeDirect(root, step);
    return;
  }
  const base = git(root, "merge-base", "HEAD", git(root, "rev-parse", "--verify", `${baseRef}^{commit}`));
  const files = changedFiles(root, base);
  if (!files) throw new Error("Cannot determine changed files");
  for (const step of codePlan(base, files, root)) await executeDirect(root, step);
}
async function execute(root, step, log) {
  const [name, command, ...args] = step;
  console.log(`\n[${name}] ${[command, ...args].join(" ")}`);
  writeFileSync(log, "", { mode: 0o600 });
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      appendFileSync(log, chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      appendFileSync(log, chunk);
    });
    child.on("error", (error) => {
      appendFileSync(log, error.message);
      console.error(error.message);
    });
    child.on("close", (code, signal) => resolveResult({ code: code ?? 1, signal }));
  });
}
export async function verify(root, baseRef, preview = false, includeImages = false) {
  const base = git(root, "merge-base", "HEAD", git(root, "rev-parse", "--verify", `${baseRef}^{commit}`));
  const files = changedFiles(root, base);
  if (!files) throw new Error("Cannot determine changed files");
  const steps = includeImages ? releasePlan(base, files) : plan(base);
  if (preview) {
    console.log(JSON.stringify({ base, files, steps }, null, 2));
    return;
  }
  const directory = resolve(root, git(root, "rev-parse", "--git-path", "agent-ci"));
  mkdirSync(directory, { recursive: true });
  const lock = resolve(directory, "lock");
  mkdirSync(lock); // A second verifier must not overwrite active evidence.
  const report = {
    startedAt: new Date().toISOString(),
    head: git(root, "rev-parse", "HEAD"),
    base,
    status: "running",
    steps: [],
  };
  const reportPath = resolve(directory, "result.json");
  const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  try {
    save();
    const before = snapshot(root);
    for (const step of steps) {
      report.activeStep = step[0];
      save();
      const log = resolve(directory, `${step[0]}.log`);
      const result = await execute(root, step, log);
      report.steps.push({ name: step[0], command: step.slice(1), log, ...result });
      save();
      if (result.code !== 0)
        throw new Error(
          `${step[0]} failed; fix the cause and rerun just ${includeImages ? "ci-release" : "ci"} ${baseRef}. Log: ${log}`,
        );
    }
    if (before !== snapshot(root)) throw new Error("Files changed during verification; review changes and rerun");
    report.status = "passed";
    report.activeStep = null;
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
    rmSync(lock, { recursive: true });
    console.log(`CI result: ${reportPath}`);
  }
}
function clean(root) {
  if (git(root, "status", "--porcelain", "--untracked-files=all"))
    throw new Error("Push requires a clean working tree; review and commit your changes first");
}
function remoteHead(root, remote, branch) {
  return git(root, "ls-remote", "--heads", remote, `refs/heads/${branch}`).split(/\s/)[0];
}
export async function push(root, remote, branch) {
  clean(root);
  const head = git(root, "rev-parse", "HEAD");
  if (!git(root, "remote").split("\n").includes(remote)) throw new Error("Use a configured Git remote name");
  if (git(root, "remote", "get-url", "--all", remote) !== git(root, "remote", "get-url", "--push", "--all", remote)) {
    throw new Error("Fetch and push URLs must match for verified push");
  }
  const current = git(root, "symbolic-ref", "--short", "HEAD");
  branch ||= current;
  if (branch !== current) throw new Error("Push destination must match the current branch");
  git(root, "check-ref-format", `refs/heads/${branch}`);
  const target = remoteHead(root, remote, branch);
  // Fetch explicit refs without changing local branches or managed hooks.
  git(root, "fetch", "--no-tags", remote, "refs/heads/main");
  const main = git(root, "rev-parse", "FETCH_HEAD");
  if (git(root, "merge-base", head, main) !== main)
    throw new Error("Integrate current remote main before verified push");
  if (target) {
    git(root, "fetch", "--no-tags", remote, `refs/heads/${branch}`);
    if (git(root, "merge-base", head, target) !== target)
      throw new Error("Remote branch has diverged; integrate it and verify again");
  }
  await verify(root, main);
  clean(root);
  if (git(root, "rev-parse", "HEAD") !== head) throw new Error("HEAD changed during verification");
  if (remoteHead(root, remote, branch) !== target || remoteHead(root, remote, "main") !== main) {
    throw new Error("Remote moved during verification; rerun just push");
  }
  // Push only the verified commit, even if another process moves the local branch.
  console.log(git(root, "-c", "push.followTags=false", "push", remote, `${head}:refs/heads/${branch}`));
}
export function checkGoModules(root) {
  for (const project of discoverProjects(root).filter((p) => p.runtime === "go")) {
    console.log(`Checking Go module ${project.id}`);
    const result = spawnSync("go", ["mod", "tidy", "-diff"], { cwd: project.dir, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Go module consistency failed: ${project.id}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (["plan", "check"].includes(mode) && args.length <= 1)
      await verify(ROOT, args[0] || "origin/main", mode === "plan");
    else if (["release-plan", "release"].includes(mode) && args.length <= 1)
      await verify(ROOT, args[0] || "origin/main", mode === "release-plan", true);
    else if (mode === "code" && args.length <= 1) await runCode(ROOT, args[0] || "origin/main");
    else if (mode === "go-modules" && args.length === 0) checkGoModules(ROOT);
    else if (mode === "push" && args.length <= 2) await push(ROOT, args[0] || "origin", args[1]);
    else
      throw new Error(
        "Usage: just ci-code [base] | just ci-plan [base] | just ci [base] | just ci-release-plan [base] | just ci-release [base] | just push [remote] [branch]",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

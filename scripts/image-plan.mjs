import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { consumersOf, discoverProjects } from "./repository.mjs";
import { changedFiles } from "./test-affected.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const projects = discoverProjects(ROOT);
const backendServices = projects.filter(({ area, kind }) => area === "backend" && kind === "services");

function imageForProject(project) {
  const context = project.runtime === "go" ? project.path : project.runtime === "python" ? "apps/backend" : ".";
  return { service: project.id.slice("backend/".length), context, dockerfile: `${project.path}/Dockerfile` };
}

export const images = [
  ...backendServices.map(imageForProject),
  { service: "sandbox-runtime", context: ".", dockerfile: "apps/backend/services/sandbox/runtime/Dockerfile" },
  { service: "sandbox-proxy", context: ".", dockerfile: "apps/backend/services/sandbox/proxy/Dockerfile" },
  { service: "web", context: ".", dockerfile: "infra/single-vps/Dockerfile.web" },
  { service: "db-init", context: ".", dockerfile: "infra/single-vps/Dockerfile.db-init" },
];

const allServices = images.map(({ service }) => service);
const applicationServices = allServices.filter(
  (service) => !["sandbox-runtime", "sandbox-proxy", "db-init"].includes(service),
);
const pythonServices = backendServices
  .filter(({ runtime }) => runtime === "python")
  .map(imageForProject)
  .map(({ service }) => service);
const nodeServices = backendServices
  .filter(({ runtime }) => runtime === "node")
  .map(imageForProject)
  .map(({ service }) => service);
const migrationServices = backendServices
  .filter(({ path }) => existsSync(resolve(ROOT, path, "migrations")))
  .map(imageForProject)
  .map(({ service }) => service);

function consumersOfBackendLibrary(id) {
  const affected = new Set(consumersOf(projects, [id]));
  return backendServices
    .filter(({ id: serviceId }) => affected.has(serviceId))
    .map(imageForProject)
    .map(({ service }) => service);
}

function add(selected, services) {
  for (const service of services) selected.add(service);
}

function matches(file, path) {
  return file === path || file.startsWith(`${path}/`);
}

function isImageNeutralMetadata(file) {
  return (
    file === "DESIGN.md" ||
    /(^|\/)AGENTS(?:\.override)?\.md$/.test(file) ||
    /(^|\/)README\.md$/.test(file) ||
    matches(file, "docs") ||
    matches(file, ".agents") ||
    matches(file, ".cursor")
  );
}

function affectedByFile(file) {
  const selected = new Set();

  if (file === ".github/workflows/build-images.yml" || file === "scripts/image-plan.mjs") {
    add(selected, allServices);
    return selected;
  }
  if (isImageNeutralMetadata(file)) return selected;

  for (const service of allServices.filter(
    (candidate) => !["sandbox", "sandbox-runtime", "sandbox-proxy", "web", "db-init"].includes(candidate),
  )) {
    if (matches(file, `apps/backend/services/${service}`)) selected.add(service);
    if (migrationServices.includes(service) && matches(file, `apps/backend/services/${service}/migrations`)) {
      selected.add("db-init");
    }
  }

  if (matches(file, "apps/backend/services/sandbox/runtime")) selected.add("sandbox-runtime");
  else if (matches(file, "apps/backend/services/sandbox/proxy")) selected.add("sandbox-proxy");
  else if (matches(file, "apps/backend/services/sandbox")) selected.add("sandbox");

  if (matches(file, "apps/backend/libs/kernel")) add(selected, pythonServices);
  if (matches(file, "apps/backend/libs/kernel-ts")) add(selected, consumersOfBackendLibrary("backend/kernel-ts"));
  if (matches(file, "apps/backend/libs/transport-ts")) add(selected, consumersOfBackendLibrary("backend/transport-ts"));
  if (["apps/backend/pyproject.toml", "apps/backend/uv.lock"].includes(file)) add(selected, pythonServices);
  if (file === "apps/backend/.dockerignore") add(selected, pythonServices);
  if (["apps/backend/package.json", "apps/backend/pnpm-lock.yaml", "apps/backend/pnpm-workspace.yaml"].includes(file)) {
    add(selected, nodeServices);
  }
  if (file === "package.json") add(selected, [...nodeServices, "web"]);

  if (matches(file, "apps/frontend")) selected.add("web");
  if (matches(file, "schemas")) add(selected, applicationServices);

  if (file === "infra/single-vps/Dockerfile.web" || file === "infra/single-vps/nginx.conf") selected.add("web");
  if (
    file === "infra/single-vps/Dockerfile.db-init" ||
    file === "infra/single-vps/postgres-init.sh" ||
    matches(file, "infra/single-vps/seed") ||
    file === "scripts/db-migrate.sh" ||
    matches(file, "scripts/dbmigrate")
  ) {
    selected.add("db-init");
  }

  return selected;
}

function isReleaseOnly(file) {
  return (
    matches(file, "infra/single-vps") ||
    file === ".github/workflows/deploy-single-vps.yml" ||
    file === ".github/workflows/backend.yml" ||
    file === ".github/workflows/frontend.yml" ||
    file === ".github/workflows/tooling.yml" ||
    file === ".github/workflows/contracts.yml" ||
    matches(file, ".github/workflows") ||
    file === "services.yaml" ||
    file === "justfile" ||
    file === "mise.toml" ||
    file === "pnpm-lock.yaml" ||
    file === "ruff.toml" ||
    file === "oxlint.config.ts" ||
    file === "oxfmt.config.ts" ||
    file === ".pre-commit-config.yaml" ||
    matches(file, "scripts")
  );
}

function matrixFor(services) {
  const wanted = new Set(services);
  return { include: images.filter(({ service }) => wanted.has(service)) };
}

export function imagePlan(files, { forceAll = false } = {}) {
  const selected = new Set();
  const reasons = {};
  let conservative = forceAll || files === null;

  if (!conservative) {
    for (const file of files) {
      const affected = affectedByFile(file);
      if (!affected.size && !isReleaseOnly(file) && !isImageNeutralMetadata(file)) {
        conservative = true;
        break;
      }
      for (const service of affected) {
        selected.add(service);
        (reasons[service] ??= []).push(file);
      }
    }
  }

  if (conservative) add(selected, allServices);
  const build = allServices.filter((service) => selected.has(service));
  const reuse = allServices.filter((service) => !selected.has(service));
  return {
    build,
    reuse,
    buildMatrix: matrixFor(build),
    reuseMatrix: matrixFor(reuse),
    reasons,
    conservative,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const forceAll = args.includes("--all");
    const unknown = args.filter((arg) => arg !== "--all");
    if (unknown.length > 1) throw new Error("Usage: node scripts/image-plan.mjs [base] [--all]");
    const base = unknown[0] ?? "HEAD";
    const files = forceAll ? null : changedFiles(ROOT, base);
    process.stdout.write(`${JSON.stringify(imagePlan(files, { forceAll }))}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

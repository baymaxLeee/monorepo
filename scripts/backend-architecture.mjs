import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const layers = new Set(["api", "application", "bootstrap", "domain", "infrastructure"]);
const forbiddenTargets = {
  api: new Set(["bootstrap", "infrastructure"]),
  application: new Set(["api", "bootstrap", "infrastructure"]),
  bootstrap: new Set(),
  domain: new Set(["api", "application", "bootstrap", "infrastructure"]),
  infrastructure: new Set(["api", "bootstrap"]),
};

function walk(path) {
  if (!existsSync(path)) return [];
  const files = [];
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const child = resolve(path, entry);
    const stat = lstatSync(child);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) files.push(...walk(child));
    else if (entry.endsWith(".go")) files.push(child);
  }
  return files;
}

function goImports(source) {
  const imports = [];
  const single = /^\s*import\s+[^"`]*["`]([^"`]+)["`]/gm;
  const block = /import\s*\(([^]*?)\)/gm;
  for (const match of source.matchAll(single)) imports.push(match[1]);
  for (const match of source.matchAll(block)) {
    for (const item of match[1].matchAll(/["`]([^"`]+)["`]/g)) imports.push(item[1]);
  }
  return imports;
}

function sourceLayer(path) {
  const parts = path.split("/");
  const internal = parts.indexOf("internal");
  return internal >= 0 && layers.has(parts[internal + 1]) ? parts[internal + 1] : undefined;
}

function targetLayer(path) {
  const match = path.match(/\/internal\/(api|application|bootstrap|domain|infrastructure)(?:\/|$)/);
  return match?.[1];
}

function loadExceptions(root) {
  const path = resolve(root, "apps/backend/architecture-import-exceptions.json");
  if (!existsSync(path)) return new Set();
  const entries = JSON.parse(readFileSync(path, "utf8"));
  return new Set(entries.map(({ source, target }) => `${source}\0${target}`));
}

export function backendArchitectureErrors(root) {
  const backend = resolve(root, "apps/backend/services");
  const exceptions = loadExceptions(root);
  const usedExceptions = new Set();
  const errors = [];

  for (const file of walk(backend)) {
    const source = relative(root, file).split(sep).join("/");
    const layer = sourceLayer(source);
    const imports = goImports(readFileSync(file, "utf8"));

    for (const target of imports) {
      const targetName = targetLayer(target);
      if (layer && targetName && forbiddenTargets[layer].has(targetName)) {
        const key = `${source}\0${target}`;
        if (exceptions.has(key)) usedExceptions.add(key);
        else errors.push(`${source}: ${layer} must not import outer ${targetName} package ${target}`);
      }
    }

    const role = source.match(/^apps\/backend\/services\/[^/]+\/cmd\/(server|worker|seed)\/.*\.go$/)?.[1];
    if (role) {
      for (const target of imports) {
        const targetName = targetLayer(target);
        if (targetName && targetName !== "bootstrap") {
          errors.push(`${source}: ${role} entrypoint may only import the service bootstrap layer, got ${target}`);
        }
      }
    }
  }

  for (const exception of exceptions) {
    if (!usedExceptions.has(exception)) {
      const [source, target] = exception.split("\0");
      errors.push(`stale backend architecture exception: ${source} -> ${target}`);
    }
  }
  return errors.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const errors = backendArchitectureErrors(root);
  if (errors.length) {
    for (const error of errors) console.error(`✗ ${error}`);
    process.exitCode = 1;
  } else {
    console.log("✓ backend Go imports follow the canonical dependency direction");
  }
}

import { existsSync, globSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function discoverProjects(root) {
  const projects = [];
  for (const area of ["backend", "frontend"]) {
    for (const kind of area === "backend" ? ["services", "libs"] : ["apps", "packages"]) {
      for (const path of globSync(`apps/${area}/${kind}/*`, { cwd: root }).sort()) {
        const dir = join(root, path);
        const manifest = existsSync(join(dir, "package.json"))
          ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
          : null;
        const runtime =
          area === "frontend"
            ? manifest
              ? "frontend"
              : null
            : existsSync(join(dir, "go.mod"))
              ? "go"
              : existsSync(join(dir, "pyproject.toml"))
                ? "python"
                : manifest
                  ? "node"
                  : null;
        if (!runtime) continue;
        if (manifest && !manifest.name) throw new Error(`${path}/package.json: missing package name`);
        projects.push({
          id: `${area}/${area === "frontend" ? manifest.name : path.split("/").at(-1)}`,
          area,
          kind,
          path,
          dir,
          runtime,
          packageName: manifest?.name ?? null,
          manifest,
          dependencies: [],
          dependencyErrors: [],
        });
      }
    }
  }
  for (const project of projects) {
    const declarations = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    for (const field of declarations) {
      for (const [name, version] of Object.entries(project.manifest?.[field] ?? {})) {
        const candidates = projects.filter((p) => p.area === project.area && p.packageName === name);
        const local = /^(workspace:|file:|link:)/.test(version);
        if (candidates.length === 1) project.dependencies.push(candidates[0].id);
        else if (local || candidates.length > 1)
          project.dependencyErrors.push(`${field}.${name}: unresolved local dependency`);
      }
    }
    project.dependencies = [...new Set(project.dependencies)].sort();
    delete project.manifest;
  }
  return projects;
}

export function consumersOf(projects, ids) {
  const selected = new Set(ids);
  for (let size = -1; size !== selected.size;) {
    size = selected.size;
    for (const project of projects) {
      if (project.dependencies?.some((id) => selected.has(id))) selected.add(project.id);
    }
  }
  return [...selected].sort();
}

export function ownerOf(projects, root, path) {
  const absolute = resolve(root, path);
  return projects.find((p) => absolute === p.dir || absolute.startsWith(`${p.dir}${sep}`)) ?? null;
}

export function instructionChain(root, path) {
  const absolute = resolve(root, path);
  const within = (candidate, base = root) => {
    const rel = relative(base, candidate);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (!within(absolute)) throw new Error("Path must be inside the repository");
  let dir = absolute;
  while (!existsSync(dir)) dir = dirname(dir);
  if (!within(realpathSync(dir), realpathSync(root))) throw new Error("Path resolves outside the repository");
  if (!statSync(dir).isDirectory()) dir = dirname(dir);
  const chain = [];
  for (;;) {
    const file = ["AGENTS.override.md", "AGENTS.md"].find((name) => existsSync(join(dir, name)));
    if (file) chain.unshift(relative(root, join(dir, file)).split(sep).join("/"));
    if (dir === root) return chain;
    dir = dirname(dir);
  }
}

export function graphErrors(projects) {
  const errors = [];
  const byId = new Map();
  const packageNames = new Set();
  for (const project of projects) {
    if (byId.has(project.id)) errors.push(`Duplicate project: ${project.id}`);
    byId.set(project.id, project);
    const packageKey = `${project.area}/${project.packageName}`;
    if (project.packageName && packageNames.has(packageKey)) errors.push(`Duplicate package name: ${packageKey}`);
    packageNames.add(packageKey);
    for (const error of project.dependencyErrors) errors.push(`${project.id}: ${error}`);
    for (const id of project.dependencies) {
      const dependency = projects.find((p) => p.id === id);
      if (["apps", "services"].includes(dependency?.kind))
        errors.push(`${project.id}: must not depend on deployable ${id}`);
    }
  }
  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      errors.push(`Dependency cycle through ${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return errors;
}

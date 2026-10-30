import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { consumersOf, discoverProjects, graphErrors, instructionChain, ownerOf } from "./repository.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function contextFor(root, input, projects = discoverProjects(root)) {
  const target = projects.find((p) => p.id === input);
  if (!target && /^(frontend|backend)\//.test(input)) throw new Error(`Unknown target: ${input}. Run just repo-map.`);
  const path = target?.path ?? input;
  const instructions = instructionChain(root, path);
  const owner = target ?? ownerOf(projects, root, path);
  const routes = ["docs/index.md"];
  if (owner?.area === "frontend") routes.push("apps/frontend/AGENTS.md", "DESIGN.md");
  if (owner?.area === "backend") routes.push("services.yaml", "apps/backend/AGENTS.md");
  return {
    path: relative(root, resolve(root, path)).split("\\").join("/") || ".",
    owner: owner?.id ?? null,
    instructions,
    routes: routes.filter((p) => existsSync(join(root, p)) && !instructions.includes(p)),
    dependencies: owner?.dependencies ?? [],
    consumers: owner ? consumersOf(projects, [owner.id]).filter((id) => id !== owner.id) : [],
    commands: owner
      ? { test: `just test ${owner.id}`, affected: `just test-affected HEAD ${owner.area} --list` }
      : { check: "just check-repo", test: "just test tooling" },
    dependencyErrors: owner?.dependencyErrors ?? [],
  };
}

export function navigationErrors(root, files) {
  const errors = [];
  for (const file of files) {
    const content = readFileSync(join(root, file), "utf8");
    for (const [, destination] of content.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(destination)) continue;
      const path = decodeURIComponent(destination.split("#")[0]);
      if (!existsSync(resolve(root, dirname(file), path))) errors.push(`${file}: broken link ${destination}`);
    }
  }
  return errors;
}

export function checkRepository(root) {
  const files = globSync(
    [
      "AGENTS.md",
      "DESIGN.md",
      "README.md",
      "scripts/{AGENTS,README}.md",
      ".agents/**/*.md",
      "apps/{backend,frontend}/AGENTS.md",
      "apps/{backend,frontend}/{services,libs,apps,packages}/*/AGENTS.md",
      "docs/**/*.md",
    ],
    {
      cwd: root,
      exclude: [".agents/tasks/**", "docs/plans/**", "docs/baselines/**", "docs/阶段性进展/**", "docs/**/*-plan.md"],
    },
  );
  return [...graphErrors(discoverProjects(root)), ...navigationErrors(root, files)];
}

export function main(args, root = ROOT) {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const [command, input] = positional;
  if (
    positional.length > (command === "context" ? 2 : 1) ||
    args.some((arg) => arg.startsWith("--") && arg !== "--json")
  )
    throw new Error("Usage: just repo-map [--json] | just context <path-or-target> [--json] | just check-repo");
  if (command === "check") {
    const errors = checkRepository(root);
    if (errors.length) throw new Error(errors.join("\n"));
    console.log("Repository graph and navigation checks passed.");
  } else if (command === "map") {
    const projects = discoverProjects(root).map(({ id, path, runtime, dependencies }) => ({
      id,
      path,
      runtime,
      dependencies,
    }));
    console.log(
      json
        ? JSON.stringify(projects, null, 2)
        : projects.map((p) => `${p.id}\t${p.path}\t${p.runtime}\t${p.dependencies.join(", ") || "—"}`).join("\n"),
    );
  } else if (command === "context" && input) {
    const context = contextFor(root, input);
    console.log(
      json
        ? JSON.stringify(context, null, 2)
        : [
            `Path: ${context.path}`,
            `Owner: ${context.owner ?? "repository / directory guidance"}`,
            `Instructions: ${context.instructions.join(" -> ") || "none"}`,
            `Read when relevant: ${context.routes.join(", ")}`,
            `Dependencies: ${context.dependencies.join(", ") || "none declared"}`,
            `Consumers: ${context.consumers.join(", ") || "none declared"}`,
            ...Object.values(context.commands),
            ...context.dependencyErrors,
          ].join("\n"),
    );
  } else throw new Error("Usage: just repo-map [--json] | just context <path-or-target> [--json] | just check-repo");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

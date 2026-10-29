import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverTargets, runSelection } from "./test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scopes = ["backend", "frontend", "tooling"];

export function changedFiles(root, base) {
  if (base === "all" || /^0+$/.test(base)) return null;
  const tracked = spawnSync("git", ["diff", "--name-only", "-z", "--no-renames", base, "--"], {
    cwd: root,
    encoding: "utf8",
  });
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  if (tracked.status !== 0 || untracked.status !== 0) return null;
  return [...new Set(`${tracked.stdout}${untracked.stdout}`.split("\0").filter(Boolean))];
}

export function affectedSelections(files, targets, root, scope = "all") {
  if (scope !== "all" && !scopes.includes(scope)) throw new Error(`Unknown test scope: ${scope}`);
  const selected = new Set();
  const all = () => scopes.forEach((area) => selected.add(area));
  if (files === null) all();
  for (const file of files ?? []) {
    // Documentation changes do not alter executable behavior.
    if (/(^|\/)(AGENTS|README)\.md$/.test(file) || file.startsWith("docs/") || file.startsWith(".agents/")) continue;
    const area = file.startsWith("apps/frontend/") ? "frontend" : file.startsWith("apps/backend/") ? "backend" : null;
    if (area) {
      const kind = area === "frontend" ? "apps" : "services";
      const owner = targets.find((target) => {
        const dir = relative(root, target.dir).split("\\").join("/");
        return dir.startsWith(`apps/${area}/${kind}/`) && file.startsWith(`${dir}/`);
      });
      // Shared libraries, workspace configuration and removed targets affect the stack.
      selected.add(owner?.id ?? area);
    } else if (!file.startsWith("apps/test/")) {
      all();
    }
  }
  return [...selected]
    .filter((id) => scope === "all" || id === scope || id.startsWith(`${scope}/`))
    .filter((id) => !id.includes("/") || !selected.has(id.split("/")[0]))
    .sort((a, b) => a.localeCompare(b));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [base = "HEAD", scope = "all", option] = process.argv.slice(2);
    if (option && option !== "--list") throw new Error(`Unknown option: ${option}`);
    const files = changedFiles(ROOT, base);
    if (files === null) console.log("No reliable diff base; running all tests in the selected scope.");
    const selections = affectedSelections(files, discoverTargets(ROOT), ROOT, scope);
    console.log(
      `Affected tests (${base}, ${scope}): ${selections.join(", ") || "none — no affected executable files"}`,
    );
    if (option !== "--list") {
      let status = 0;
      for (const selection of selections) status = Math.max(status, runSelection(selection));
      process.exitCode = status;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = await readFile(resolve(root, "schemas/desktop/inference.ts"), "utf8");
const generated = `// Generated from schemas/desktop/inference.ts by just sync. Do not edit.\n${source}`;
for (const path of [
  "apps/backend/services/chat/src/application/inference/generated/inference.ts",
  "apps/frontend/apps/desktop/contracts/inference.generated.ts",
]) {
  const destination = resolve(root, path);
  if (process.argv.includes("--check")) {
    if ((await readFile(destination, "utf8").catch(() => null)) !== generated)
      throw new Error(`${path} is stale; run just sync`);
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, generated);
  }
}

const bridge = `// Generated from schemas/desktop/bridge.ts by just sync. Do not edit.\n${await readFile(resolve(root, "schemas/desktop/bridge.ts"), "utf8")}`;
for (const path of [
  "apps/frontend/apps/desktop/contracts/bridge.generated.ts",
  "apps/frontend/packages/runtime/src/generated/desktop.ts",
]) {
  const destination = resolve(root, path);
  if (process.argv.includes("--check")) {
    if ((await readFile(destination, "utf8").catch(() => null)) !== bridge)
      throw new Error(`${path} is stale; run just sync`);
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bridge);
  }
}

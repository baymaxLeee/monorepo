import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = await readFile(resolve(root, "schemas/streaming/chat-ui.ts"), "utf8");
const generated = `// Generated from schemas/streaming/chat-ui.ts by just sync. Do not edit.\n${source}`;
for (const path of [
  "apps/backend/services/chat/src/application/agent/generated/chat-ui.ts",
  "apps/frontend/packages/ai-elements/src/Conversation/lib/generated/chat-ui.ts",
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

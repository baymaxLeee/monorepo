import path from "node:path";
import { fileURLToPath } from "node:url";

/** apps/frontend absolute root */
export const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

/** Internal packages resolve by their pnpm workspace package names. */
export const workspaceAliases = {};

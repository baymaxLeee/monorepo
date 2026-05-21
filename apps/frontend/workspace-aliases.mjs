import path from "node:path";
import { fileURLToPath } from "node:url";

/** apps/frontend absolute root */
export const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

/** @packages/foo → packages/foo (subpaths via packages/package.json exports) */
export const workspaceAliases = {
  "@packages": path.join(frontendRoot, "packages"),
};

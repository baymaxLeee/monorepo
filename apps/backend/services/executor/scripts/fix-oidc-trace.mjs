// Workaround for an nf3 (Nitro's dependency tracer, github.com/unjs/nf3)
// path-depth bug: `@ai-sdk/gateway` requires `@vercel/oidc` at module load
// time (even though this service never calls AI Gateway — we only use
// createOpenAICompatible). nf3 computes the wrong number of `../` segments
// when relativizing a require() inside a package nested this deep in the
// pnpm store beneath this monorepo's apps/backend workspace, so the copied
// runtime file ends up requiring a path one level too shallow and crashes
// at boot with MODULE_NOT_FOUND. `noExternals` in nitro.config.ts does not
// help — nf3's file-copy step runs independently of rolldown's own
// externalization decision. Until upstream fixes nf3, place the file where
// the (miscalculated) require path actually points.
//
// Re-run automatically via the `postbuild` npm script. Safe to run
// repeatedly; it's a no-op if the source file is missing (nothing to fix).
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serviceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const relPackage = "node_modules/.pnpm/@vercel+oidc@3.2.0/node_modules/@vercel/oidc/dist";
const source = resolve(serviceDir, "../../", relPackage); // apps/backend/<relPackage>
// Matches the exact (buggy) relative path baked into .output/server/_runtime.mjs:
// `../../../../../node_modules/.pnpm/@vercel+oidc@3.2.0/...` from .output/server/.
const brokenTarget = resolve(serviceDir, ".output/server", "../../../../../", relPackage);

if (!existsSync(source)) {
  console.log("[fix-oidc-trace] @vercel/oidc not installed, skipping");
  process.exit(0);
}
if (!existsSync(join(serviceDir, ".output"))) {
  console.log("[fix-oidc-trace] no .output directory, skipping (run after nitro build)");
  process.exit(0);
}

mkdirSync(brokenTarget, { recursive: true });
for (const file of readdirSync(source)) {
  copyFileSync(join(source, file), join(brokenTarget, file));
}
console.log(`[fix-oidc-trace] copied @vercel/oidc/dist -> ${brokenTarget}`);

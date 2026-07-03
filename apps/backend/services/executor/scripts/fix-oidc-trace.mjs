// Workaround for an nf3 (Nitro's dependency tracer, github.com/unjs/nf3)
// path-depth bug: `@ai-sdk/gateway` requires `@vercel/oidc` at module load
// time (even though this service never calls AI Gateway — we only use
// createOpenAICompatible). nf3 computes the wrong number of `../` segments
// when relativizing a require() inside a package nested this deep in the
// pnpm store beneath this monorepo's apps/backend workspace, so the copied
// runtime file ends up requiring a path one level too shallow and crashes
// at boot with MODULE_NOT_FOUND. `noExternals` in nitro.config.ts does not
// help — nf3's file-copy step runs independently of rolldown's own
// externalization decision. Until upstream fixes nf3, copy the package into
// Nitro's self-contained runtime tree and rewrite the bad relative path to
// that stable location. Copying to the path computed in the build workspace
// is insufficient because the final image relocates `.output` to `/app`.
//
// Re-run automatically via the `postbuild` npm script. Safe to run
// repeatedly; it's a no-op if the source file is missing (nothing to fix).
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serviceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pnpmDir = resolve(serviceDir, "../../node_modules/.pnpm");
const oidcPackageDir = existsSync(pnpmDir)
  ? readdirSync(pnpmDir).find((entry) => entry.startsWith("@vercel+oidc@"))
  : undefined;

if (!oidcPackageDir) {
  console.log("[fix-oidc-trace] @vercel/oidc not installed, skipping");
  process.exit(0);
}
const serverDir = resolve(serviceDir, ".output/server");
if (!existsSync(serverDir)) {
  console.log("[fix-oidc-trace] no .output directory, skipping (run after nitro build)");
  process.exit(0);
}

const source = join(pnpmDir, oidcPackageDir, "node_modules/@vercel/oidc/dist");
const target = join(serverDir, "node_modules/@vercel/oidc/dist");
const indexPath = join(serverDir, "index.mjs");
const brokenPrefix =
  `../../../../../node_modules/.pnpm/${oidcPackageDir}/node_modules/@vercel/oidc/dist/`;
const stablePrefix = "./node_modules/@vercel/oidc/dist/";

cpSync(source, target, { recursive: true });
const bundle = readFileSync(indexPath, "utf8");
const rewritten = bundle.replaceAll(brokenPrefix, stablePrefix);
if (rewritten === bundle) {
  console.log("[fix-oidc-trace] no broken @vercel/oidc path found; copied runtime files only");
} else {
  writeFileSync(indexPath, rewritten);
  console.log(`[fix-oidc-trace] rewrote @vercel/oidc path and copied dist -> ${target}`);
}

/**
 * Module Federation shared-deps registry.
 *
 * Single source of truth for which third-party packages and internal workspace
 * packages are pre-loaded by the shell (host) and consumed by every MFE
 * (remote). Goal: when a remote is loaded, the browser only downloads the
 * remote's *business code* and its remote-specific deps (e.g. `react-markdown`,
 * `monaco-editor`), NOT another copy of React or the platform UI kit.
 *
 * Why .mjs and not .ts?
 *   rspack-cli loads `rspack.config.ts` by transpiling it to .mjs in a temp
 *   directory and then handing the result to Node's native ESM loader. Native
 *   ESM cannot resolve cross-package `.ts` imports without a runtime loader,
 *   so a TS file here would crash with ERR_MODULE_NOT_FOUND. A `.mjs` file is
 *   universally recognized as ESM by Node — every rspack.config can import it
 *   with no extra tooling. Types are provided via JSDoc.
 *
 * Policy
 * ------
 * Two tiers of shared deps:
 *
 *   Tier 1 — React 18 ecosystem (framework level)
 *     react, react-dom, react-router-dom
 *     Singleton-required: multiple copies break hooks / router context.
 *
 *   Tier 2 — Platform internal packages (workspace `@app/*`)
 *     UI kit, design tokens, runtime helpers, auth client, shared types.
 *     Singleton-recommended: avoid bundle bloat across MFEs.
 *
 * Excluded from sharing (each MFE bundles its own):
 *   - Service-scoped clients like `@app/api-client/admin` (only one MFE uses it)
 *   - MFE-specific UX deps (`react-markdown`, `monaco-editor`, charts, ...)
 *
 * How to use
 * ----------
 *   // host (shell) rspack.config.ts
 *   import { buildShared } from "../../mf-shared.mjs";
 *   shared: buildShared("host")
 *
 *   // remote (mfe-*) rspack.config.ts
 *   import { buildShared } from "../../mf-shared.mjs";
 *   shared: buildShared("remote")
 *
 * Why a function?
 *   - host marks deps `eager: true` (bundled into initial chunk, registered
 *     synchronously into share-scope at startup — no async-boundary needed).
 *   - remote keeps eager OFF: when federated it consumes host's eager copy
 *     from share-scope; when standalone the remote's own async boundary
 *     (`import("./bootstrap")` in main.tsx) inits scope before consuming.
 *
 * Adding a new shared dep
 *   1. Add an entry to TIER1 or TIER2 below.
 *   2. Make sure shell statically imports it somewhere (otherwise tree-shake
 *      drops the eager copy → "factory is undefined" at runtime).
 *      For "interface-only" packages, add a side-effect line to
 *      `apps/frontend/apps/shell/src/mf-eager-anchors.ts`.
 *   3. Restart `just dev`; both shell and the MFEs pick up the change.
 */

/**
 * @typedef {Object} SharedSpec
 * @property {boolean} [singleton]
 * @property {string|false} [requiredVersion]
 * @property {boolean} [strictVersion]
 *   `false` lets host & remote drift on patch versions without warnings.
 *   Flip to `true` once the project is stable on a single React minor.
 * @property {boolean} [eager]
 */

/**
 * @typedef {"host" | "remote"} Role
 */

/**
 * Tier 1: framework-level (must be singleton; share = mandatory).
 * @type {Record<string, SharedSpec>}
 */
const TIER1 = {
  react: { singleton: true, requiredVersion: "^18.0.0", strictVersion: false },
  "react-dom": { singleton: true, requiredVersion: "^18.0.0", strictVersion: false },
  "react-router-dom": { singleton: true, requiredVersion: "^6.0.0", strictVersion: false },
};

/**
 * Tier 2: platform internal packages (no required version — workspace pinned).
 * @type {Record<string, SharedSpec>}
 */
const TIER2 = {
  "@app/shared": { singleton: true, requiredVersion: false },
  "@app/runtime": { singleton: true, requiredVersion: false },
  "@app/design-tokens": { singleton: true, requiredVersion: false },
  "@app/auth-client": { singleton: true, requiredVersion: false },
  "@app/ui-kit": { singleton: true, requiredVersion: false },
};

/**
 * Build the `shared` config dict for a Module Federation plugin instance.
 * Pass `"host"` from the shell's rspack.config; pass `"remote"` from each MFE.
 *
 * @param {Role} role
 * @returns {Record<string, SharedSpec>}
 */
export function buildShared(role) {
  const eager = role === "host";
  /** @type {Record<string, SharedSpec>} */
  const out = {};
  for (const [name, spec] of Object.entries({ ...TIER1, ...TIER2 })) {
    out[name] = { ...spec, eager };
  }
  return out;
}

/**
 * Names of all Tier 2 packages the shell MUST statically import (anywhere in
 * its source) so rspack keeps them in the initial chunk and `eager: true`
 * works. Used by the shell's `mf-eager-anchors.ts` side-effect file.
 */
export const HOST_EAGER_ANCHORS = Object.keys(TIER2);

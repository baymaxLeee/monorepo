/**
 * Type declarations for mf-shared.mjs.
 * The runtime is plain JS (.mjs) for cross-package compatibility with
 * rspack-cli's native ESM loader; types live here.
 */

export type Role = "host" | "remote";

export interface SharedSpec {
  singleton?: boolean;
  requiredVersion?: string | false;
  strictVersion?: boolean;
  eager?: boolean;
}

/**
 * Build the `shared` config dict for a Module Federation plugin instance.
 * `"host"` => eager: true on every dep (bundled into shell's initial chunk).
 * `"remote"` => eager: false (consume host's copy when federated; init via
 * async boundary when standalone).
 */
export function buildShared(role: Role): Record<string, SharedSpec>;

/**
 * Names of all Tier 2 packages the shell MUST statically import (anywhere in
 * its source) so rspack keeps them in the initial chunk and `eager: true`
 * works. Used by `apps/frontend/apps/platform/src/mf-eager-anchors.ts`.
 */
export const HOST_EAGER_ANCHORS: readonly string[];

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
  import?: string | false;
}

/**
 * Build the `shared` config dict for a Module Federation plugin instance.
 * Shared entries are limited to cross-app runtime contracts. UI, API-client,
 * and other leaf libraries are intentionally excluded so each app can rely on
 * normal bundler tree-shaking instead of host fallback chunks.
 */
export function buildShared(role: Role): Record<string, SharedSpec>;

/**
 * Names of host shared packages configured as eager.
 */
export const HOST_EAGER_ANCHORS: readonly string[];

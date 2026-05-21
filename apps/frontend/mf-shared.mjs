/**
 * Module Federation shared-deps registry.
 *
 * Tier 1 — React (singleton, host + remote)
 * Tier 2 — Platform infra (@packages/runtime, auth-client, shared)
 *
 * NOT shared (each MFE bundles on demand):
 *   @packages/components, radix-ui, lucide-react, cva, api-client per service
 *
 * Tier-2 resolves via packages/package.json exports + @packages alias.
 */

/**
 * @typedef {Object} SharedSpec
 * @property {boolean} [singleton]
 * @property {string|false} [requiredVersion]
 * @property {boolean} [strictVersion]
 * @property {boolean} [eager]
 */

/**
 * @typedef {"host" | "remote"} Role
 */

const TIER1 = {
  react: { singleton: true, requiredVersion: "^18.0.0", strictVersion: false },
  "react-dom": { singleton: true, requiredVersion: "^18.0.0", strictVersion: false },
  "react-router-dom": { singleton: true, requiredVersion: "^6.0.0", strictVersion: false },
};

const TIER2 = {
  "@packages/shared": { singleton: true, requiredVersion: false },
  "@packages/runtime": { singleton: true, requiredVersion: false },
  "@packages/auth-client": { singleton: true, requiredVersion: false },
};

/**
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

export const HOST_EAGER_ANCHORS = Object.keys(TIER2);

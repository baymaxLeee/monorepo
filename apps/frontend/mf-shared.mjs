/**
 * Module Federation shared-deps registry.
 *
 * Tier 1 — React (singleton, host + remote)
 * Tier 2 — Platform infra (@packages/runtime, auth-client, shared, zustand)
 * Tier 3 — Shared UI kit (@packages/components)
 *
 * Remote apps do not bundle fallbacks for these shared dependencies. The
 * platform host is the only user-facing entry and must provide them.
 *
 * Tier-2 resolves via packages/package.json exports + @packages alias.
 */

/**
 * @typedef {Object} SharedSpec
 * @property {boolean} [singleton]
 * @property {string|false} [requiredVersion]
 * @property {boolean} [strictVersion]
 * @property {boolean} [eager]
 * @property {string|false} [import]
 */

/**
 * @typedef {"host" | "remote"} Role
 */

const TIER1 = {
  react: { singleton: true, requiredVersion: "^18.0.0", strictVersion: false },
  "react/jsx-runtime": {
    singleton: true,
    requiredVersion: "^18.0.0",
    strictVersion: false,
  },
  "react/jsx-dev-runtime": {
    singleton: true,
    requiredVersion: "^18.0.0",
    strictVersion: false,
  },
  "react-dom": {
    singleton: true,
    requiredVersion: "^18.0.0",
    strictVersion: false,
  },
  "react-dom/client": {
    singleton: true,
    requiredVersion: "^18.0.0",
    strictVersion: false,
  },
  "react-router-dom": {
    singleton: true,
    requiredVersion: "^6.0.0",
    strictVersion: false,
  },
};

const TIER2 = {
  "@packages/shared": { singleton: true, requiredVersion: false },
  "@packages/runtime": { singleton: true, requiredVersion: false },
  "@packages/auth-client": { singleton: true, requiredVersion: false },
  zustand: { singleton: true, requiredVersion: "^5.0.0", strictVersion: false },
  "zustand/middleware": {
    singleton: true,
    requiredVersion: "^5.0.0",
    strictVersion: false,
  },
  "zustand/react/shallow": {
    singleton: true,
    requiredVersion: "^5.0.0",
    strictVersion: false,
  },
  "zustand/shallow": {
    singleton: true,
    requiredVersion: "^5.0.0",
    strictVersion: false,
  },
};

const TIER3 = {
  "@packages/components": { singleton: true, requiredVersion: false },
};

const SHARED = { ...TIER1, ...TIER2, ...TIER3 };

/**
 * @param {Role} role
 * @returns {Record<string, SharedSpec>}
 */
export function buildShared(role) {
  const eager = role === "host";
  /** @type {Record<string, SharedSpec>} */
  const out = {};
  for (const [name, spec] of Object.entries(SHARED)) {
    out[name] = { ...spec, eager };
    if (role === "remote") {
      out[name].import = false;
    }
  }
  return out;
}

export const HOST_EAGER_ANCHORS = Object.keys({ ...TIER2, ...TIER3 });

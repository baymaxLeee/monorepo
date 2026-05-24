/**
 * Module Federation shared-deps registry.
 *
 * Tier 1 — React core ecosystem:
 * React, React DOM, JSX runtimes, and React Router. These must be singleton
 * because hooks, context, and router state break when duplicated.
 *
 * Tier 2 — Internal runtime contracts:
 * @packages/runtime and @packages/shared are product-owned runtime contracts
 * consumed by host and remotes.
 *
 * Tier 3 — State management:
 * Zustand and its subpath exports. Stores and selector helpers must resolve to
 * one runtime copy across host/remotes.
 *
 * UI, API-client, and other leaf libraries stay out of Module Federation
 * shared config by default. That lets each app rely on normal bundler
 * tree-shaking instead of forcing the host to provide a package-level fallback
 * chunk.
 *
 * Internal packages resolve via package.json exports + @packages alias.
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
  "react-router": {
    singleton: true,
    requiredVersion: "^6.0.0",
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
};

const TIER3 = {
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

const SHARED = { ...TIER1, ...TIER2, ...TIER3 };

const HOST_EAGER_SHARED = new Set([
  ...Object.keys(TIER1),
  "@packages/shared",
  "@packages/runtime",
]);

/**
 * @param {Role} role
 * @returns {Record<string, SharedSpec>}
 */
export function buildShared(role) {
  /** @type {Record<string, SharedSpec>} */
  const out = {};
  for (const [name, spec] of Object.entries(SHARED)) {
    out[name] = {
      ...spec,
      eager: role === "host" && HOST_EAGER_SHARED.has(name),
    };
    if (role === "remote") {
      out[name].import = false;
    }
  }
  return out;
}

export const HOST_EAGER_ANCHORS = [...HOST_EAGER_SHARED];

/**
 * Module Federation shared-deps registry.
 *
 * Tier 1 — React core ecosystem:
 * React, React DOM, JSX runtimes, and React Router. These must be singleton
 * because hooks, context, and router state break when duplicated.
 *
 * Tier 2 — Internal workspace packages:
 * product-owned packages consumed by host and remotes. The shared keys match
 * the real pnpm workspace package names so package.json dependencies, TypeScript
 * resolution, bundler resolution, and Module Federation all use one identity.
 *
 * Tier 3 — State management:
 * Zustand core runtime and middleware used by the shared platform store.
 * React selector helpers are shared too because host and remotes both use them
 * in store selectors.
 *
 * Internal packages resolve through package.json exports and workspace links.
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
  shared: { singleton: true, requiredVersion: false },
  runtime: { singleton: true, requiredVersion: false },
  observability: { singleton: true, requiredVersion: false },
  api: { singleton: true, requiredVersion: false },
  components: { singleton: true, requiredVersion: false },
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
};

const SHARED = { ...TIER1, ...TIER2, ...TIER3 };

const HOST_EAGER_SHARED = new Set([
  ...Object.keys(TIER1),
  ...Object.keys(TIER3),
  "shared",
  "runtime",
  "observability",
  "api",
  "components",
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

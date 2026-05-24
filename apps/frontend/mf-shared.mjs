/**
 * Module Federation shared-deps registry.
 *
 * Tier 1 — React core ecosystem:
 * React, React DOM, JSX runtimes, and React Router. These must be singleton
 * because hooks, context, and router state break when duplicated.
 *
 * Tier 2 — Internal workspace packages:
 * @packages/* runtime, API, shared utilities, and component library. These are
 * product-owned shared contracts consumed by host and remotes.
 *
 * Tier 3 — State management:
 * Zustand and its subpath exports. Stores and selector helpers must resolve to
 * one runtime copy across host/remotes.
 *
 * Tier 4 — UI/form/runtime infrastructure:
 * shadcn/Radix primitives, Tailwind helper utilities, icons, form validation,
 * toast, HTTP client, and class composition helpers used by shared UI or MFE
 * business code.
 *
 * Remote apps do not bundle fallbacks for these shared dependencies. The
 * platform host is the only user-facing entry and must provide them.
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
  "react-router-dom": {
    singleton: true,
    requiredVersion: "^6.0.0",
    strictVersion: false,
  },
};

const TIER2 = {
  "@packages/shared": { singleton: true, requiredVersion: false },
  "@packages/runtime": { singleton: true, requiredVersion: false },
  "@packages/api": { singleton: true, requiredVersion: false },
  "@packages/components": { singleton: true, requiredVersion: false },
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

const TIER4 = {
  "@hookform/resolvers": {
    singleton: true,
    requiredVersion: "^5.0.0",
    strictVersion: false,
  },
  "@hookform/resolvers/zod": {
    singleton: true,
    requiredVersion: "^5.0.0",
    strictVersion: false,
  },
  "class-variance-authority": {
    singleton: true,
    requiredVersion: "^0.7.0",
    strictVersion: false,
  },
  "lucide-react": {
    singleton: true,
    requiredVersion: "^0.468.0",
    strictVersion: false,
  },
  "radix-ui": {
    singleton: true,
    requiredVersion: "^1.0.0",
    strictVersion: false,
  },
  "react-hook-form": {
    singleton: true,
    requiredVersion: "^7.0.0",
    strictVersion: false,
  },
  sonner: {
    singleton: true,
    requiredVersion: "^2.0.0",
    strictVersion: false,
  },
  zod: {
    singleton: true,
    requiredVersion: "^4.0.0",
    strictVersion: false,
  },
  axios: {
    singleton: true,
    requiredVersion: "^1.0.0",
    strictVersion: false,
  },
  clsx: {
    singleton: true,
    requiredVersion: "^2.0.0",
    strictVersion: false,
  },
  "tailwind-merge": {
    singleton: true,
    requiredVersion: "^2.0.0",
    strictVersion: false,
  },
};

const SHARED = { ...TIER1, ...TIER2, ...TIER3, ...TIER4 };

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

export const HOST_EAGER_ANCHORS = Object.keys({
  ...TIER2,
  ...TIER3,
  ...TIER4,
});

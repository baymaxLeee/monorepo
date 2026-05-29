/**
 * Module Federation shared-deps registry.
 *
 * - Tier1 React/Router: singleton (hooks/context/router break if duplicated);
 *   React is strictVersion so an incompatible copy fails loudly, not silently.
 * - Tier2 runtime/shared/observability: cross-MFE runtime identity → singleton.
 *   (UI kit `components` + `api` stay normal deps so each app tree-shakes them.)
 * - Tier3 Zustand: singleton for the shared platform store.
 * - Tier4 heavy leaf libs (tiptap/codemirror): singleton:false dedupe, provided
 *   by remotes (host never imports), de-duped into one runtime chunk.
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
  react: { singleton: true, requiredVersion: "^18.0.0", strictVersion: true },
  "react/jsx-runtime": {
    singleton: true,
    requiredVersion: "^18.0.0",
    strictVersion: true,
  },
  "react/jsx-dev-runtime": {
    singleton: true,
    requiredVersion: "^18.0.0",
    strictVersion: true,
  },
  "react-dom": {
    singleton: true,
    requiredVersion: "^18.0.0",
    strictVersion: true,
  },
  "react-dom/client": {
    singleton: true,
    requiredVersion: "^18.0.0",
    strictVersion: true,
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

/**
 * Heavy, dedupe-only libraries. Provided by remotes (not the host) and shared
 * across remotes via the runtime share scope. Add an entry here ONLY when a
 * library is (1) heavy, (2) stable across versions, and (3) imported by 2+ apps
 * through `components`. Tree-shaking still applies inside the shared chunk.
 */
const TIER4_DEDUPE = {
  "@tiptap/core": {
    singleton: false,
    requiredVersion: "^3.0.0",
    strictVersion: false,
  },
  "@tiptap/react": {
    singleton: false,
    requiredVersion: "^3.0.0",
    strictVersion: false,
  },
  "@tiptap/pm": {
    singleton: false,
    requiredVersion: "^3.0.0",
    strictVersion: false,
  },
  "@tiptap/starter-kit": {
    singleton: false,
    requiredVersion: "^3.0.0",
    strictVersion: false,
  },
  "@codemirror/state": {
    singleton: false,
    requiredVersion: "^6.0.0",
    strictVersion: false,
  },
  "@codemirror/view": {
    singleton: false,
    requiredVersion: "^6.0.0",
    strictVersion: false,
  },
  "@codemirror/language": {
    singleton: false,
    requiredVersion: "^6.0.0",
    strictVersion: false,
  },
};

/** Singleton runtime contracts the host owns and provides to every remote. */
const HOST_SHARED = { ...TIER1, ...TIER2, ...TIER3 };

/** Remotes consume host singletons AND can provide/dedupe Tier-4 leaf libs. */
const REMOTE_CONSUME = { ...TIER1, ...TIER2, ...TIER3 };

/**
 * `shared` config for an MF plugin instance.
 * - Host: provides every singleton (not eager — async bootstrap boundary).
 * - Remote: Tier1-3 `import:false` (consume host singleton); Tier4 bundled so
 *   the remote can provide + dedupe it.
 * @param {Role} role
 * @returns {Record<string, SharedSpec>}
 */
export function buildShared(role) {
  /** @type {Record<string, SharedSpec>} */
  const out = {};

  if (role === "host") {
    for (const [name, spec] of Object.entries(HOST_SHARED)) {
      out[name] = { ...spec, eager: false };
    }
    return out;
  }

  for (const [name, spec] of Object.entries(REMOTE_CONSUME)) {
    out[name] = { ...spec, eager: false, import: false };
  }
  for (const [name, spec] of Object.entries(TIER4_DEDUPE)) {
    out[name] = { ...spec, eager: false };
  }
  return out;
}

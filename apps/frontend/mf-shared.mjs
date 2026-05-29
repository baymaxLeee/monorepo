/**
 * Module Federation shared-deps registry.
 *
 * Tier 1 — React core ecosystem:
 * React, React DOM, JSX runtimes, and React Router. These MUST be singleton
 * because hooks, context, and router state break when duplicated. React itself
 * is `strictVersion` so a genuinely incompatible copy fails loudly at load time
 * instead of silently rendering a second React.
 *
 * Tier 2 — Internal runtime packages:
 * only packages that carry cross-MFE runtime identity/state belong here.
 * UI kits and API clients stay as normal workspace dependencies so each app can
 * tree-shake the imports it actually uses.
 *
 * Tier 3 — State management:
 * Zustand core runtime and middleware used by the shared platform store.
 *
 * Tier 4 — Heavy leaf libraries (DEDUPE, NOT singleton):
 * Large, stable third-party engines (rich-text / code editor cores) that two or
 * more remotes may each pull in through `components`. They are shared with
 * `singleton: false` so identical versions are de-duplicated into ONE async
 * chunk negotiated at runtime, while incompatible versions can still load side
 * by side. They are NOT provided by the host (platform never imports them) —
 * the first remote that needs one registers it into the shared scope and later
 * remotes reuse it. This keeps tree-shaking intact (leaf libs) and avoids
 * shipping the same editor engine inside every remote bundle.
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
 * Build the `shared` config dict for a Module Federation plugin instance.
 *
 * Host (platform):
 *   - provides every singleton; not eager because the entry uses an async
 *     `import("./bootstrap")` boundary, so shared factories are registered
 *     before any host/remote code consumes them.
 *
 * Remote (mfe_*):
 *   - Tier 1-3: `import: false` — never bundle a fallback copy, always consume
 *     the host's singleton.
 *   - Tier 4: bundled normally (no `import: false`) so the remote can act as a
 *     provider; `singleton: false` dedupes identical versions at runtime.
 *
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

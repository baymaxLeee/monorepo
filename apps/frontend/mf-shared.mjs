/**
 * Module Federation shared-deps registry.
 *
 * - Tier1 React/Router: singleton (hooks/context/router break if duplicated);
 *   React is strictVersion so an incompatible copy fails loudly, not silently.
 * - Tier2 runtime/shared/observability: cross-MFE runtime identity → singleton.
 *   (UI kit `components` + `api` stay normal deps so each app tree-shakes them.)
 * - Tier3 Zustand: singleton for the shared platform store.
 * - Tier4 editor runtimes (tiptap/prosemirror): singleton because editor state,
 *   plugin decorations, node views, and commands carry runtime object identity.
 *   Remotes provide them on demand; the first loaded remote owns the singleton.
 * - Tier5 heavy leaf libs (codemirror): singleton:false dedupe, provided by
 *   remotes (host never imports), de-duped into one runtime chunk.
 */

/**
 * @typedef {Object} SharedSpec
 * @property {boolean} [singleton]
 * @property {string|false} [requiredVersion]
 * @property {boolean} [strictVersion]
 * @property {string|false} [import]
 */

/**
 * @typedef {"host" | "remote"} Role
 */

// react core must singleton
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

// runtime core must singleton
const TIER2 = {
  shared: { singleton: true, requiredVersion: false },
  runtime: { singleton: true, requiredVersion: false },
  observability: { singleton: true, requiredVersion: false },
};

// global store must singleton
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

const EDITOR_SINGLETON_SPEC = {
  singleton: true,
  requiredVersion: "^3.0.0",
  strictVersion: false,
};

// prosemirror/tiptap must singleton
const TIER4 = {
  "@tiptap/core": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/react": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/react/menus": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/pm": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/pm/model": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/pm/state": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/pm/tables": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/pm/view": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/starter-kit": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/markdown": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-code": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-code-block-lowlight": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-code-block": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-color": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-highlight": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-image": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-table": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-table-header": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-table-row": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-task-item": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-task-list": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-text-align": {
    ...EDITOR_SINGLETON_SPEC,
  },
  "@tiptap/extension-text-style": {
    ...EDITOR_SINGLETON_SPEC,
  },
};

// remote-provided dedupe-only libraries
const TIER5 = {
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

/** Runtime contracts the host owns and provides to every remote. */
const hostProviders = { ...TIER1, ...TIER2, ...TIER3 };

/** Runtime contracts remotes can provide on demand and consume from each other. */
const remoteProviders = {
  ...TIER4,
  ...TIER5,
};

/**
 * `shared` config for an MF plugin instance.
 * - Host: provides platform-owned runtime contracts.
 * - Remote: consumes host-owned contracts with `import:false`; editor/dedupe
 *   contracts stay bundled so remotes can provide and consume them on demand.
 * @param {Role} role
 * @returns {Record<string, SharedSpec>}
 */
export function buildShared(role) {
  /** @type {Record<string, SharedSpec>} */
  const out = {};

  if (role === "host") {
    for (const [name, spec] of Object.entries(hostProviders)) {
      out[name] = { ...spec };
    }
    return out;
  }

  for (const [name, spec] of Object.entries(hostProviders)) {
    out[name] = { ...spec, import: false };
  }

  for (const [name, spec] of Object.entries(remoteProviders)) {
    out[name] = { ...spec };
  }
  return out;
}

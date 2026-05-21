/**
 * MFE registry — single source of truth for which MFEs exist,
 * which routes they own, and how to discover them.
 *
 * When adding a new MFE:
 * 1. Add an entry here
 * 2. Add it to rspack.config.ts remotes
 * 3. Add a <Route> in App.tsx
 */
export interface MfeEntry {
  id: string;
  title: string;
  basePath: string;
  remoteName: string;
  exposeKey: string;
}

export const registry: MfeEntry[] = [
  {
    id: "admin",
    title: "智能体",
    basePath: "/bots",
    remoteName: "mfe_admin",
    exposeKey: "./App",
  },
  // Add more MFEs here:
  // { id: "scene", title: "场景", basePath: "/scenes", remoteName: "mfe_scene", exposeKey: "./App" },
];

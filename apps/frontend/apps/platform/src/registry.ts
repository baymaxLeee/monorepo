/**
 * MFE registry — single source of truth for which MFEs exist,
 * which routes they own, and how to discover them.
 *
 * URL layout (platform host):
 *   /              — shell root (redirects when authed)
 *   /login         — auth page
 *   /platform/home — platform shell home / app switcher
 *   /platform/<id> — each remote entry (e.g. /platform/admin)
 *
 * When adding a new MFE:
 * 1. Add an entry here (`basePath`: `/platform/<slug>`)
 * 2. Add it to rspack.config.ts remotes
 * 3. Register lazy import in App.tsx `remoteApps`
 */
export interface MfeEntry {
  id: string;
  title: string;
  /** Host-mounted path, no trailing slash — e.g. `/platform/admin` */
  basePath: string;
  remoteName: string;
  exposeKey: string;
}

export const registry: MfeEntry[] = [
  {
    id: "admin",
    title: "后台管理",
    basePath: "/platform/admin",
    remoteName: "mfe_admin",
    exposeKey: "./App",
  },
  // { id: "scene", title: "场景", basePath: "/platform/scene", remoteName: "mfe_scene", exposeKey: "./App" },
];

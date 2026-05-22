/**
 * MFE registry — single source of truth for which MFEs exist,
 * which routes they own, and how to discover them.
 *
 * URL layout (platform host):
 *   /              — shell root (redirects when authed)
 *   /login         — auth page
 *   /platform/<id> — each remote (e.g. /platform/admin)
 *
 * When adding a new MFE:
 * 1. Add an entry here (`basePath`: `/platform/<slug>`)
 * 2. Add it to rspack.config.ts remotes
 * 3. Register lazy import in App.tsx `remoteApps`
 */
export interface MfeSubNavItem {
  title: string;
  /** Absolute path under host, e.g. `/platform/admin/demo` */
  href: string;
}

export interface MfeEntry {
  id: string;
  title: string;
  /** Host-mounted path, no trailing slash — e.g. `/platform/admin` */
  basePath: string;
  remoteName: string;
  exposeKey: string;
  /** Shown in sidebar when route is under this MFE */
  subNav?: MfeSubNavItem[];
}

/** Shell root — redirects to default app when authenticated. */
export const HOME_PATH = "/";

/** Unauthenticated users are sent here. */
export const LOGIN_PATH = "/login";

export const registry: MfeEntry[] = [
  {
    id: "admin",
    title: "智能体",
    basePath: "/platform/admin",
    remoteName: "mfe_admin",
    exposeKey: "./App",
    subNav: [
      { title: "列表", href: "/platform/admin" },
      { title: "组件演示", href: "/platform/admin/demo" },
    ],
  },
  // { id: "scene", title: "场景", basePath: "/platform/scene", remoteName: "mfe_scene", exposeKey: "./App" },
];

/** Default landing route after login (first registry entry). */
export const defaultAppPath = registry[0]?.basePath ?? "/platform/admin";

/**
 * MFE registry — single source of truth for which MFEs exist, which routes
 * they own, and how to discover them at runtime.
 *
 * URL layout (platform host):
 *   /              — shell root (redirects when authed)
 *   /login         — auth page
 *   /platform/home — platform shell home / app switcher
 *   /platform/<id> — each remote entry (e.g. /platform/admin)
 *
 * MF 2.0 dynamic remotes: this registry — not the rspack config — is the
 * single source for remote names + manifest URLs. `bootstrap.tsx` feeds these
 * into `registerRemotes()`, and the router resolves them via `loadRemote()`.
 *
 * When adding a new MFE:
 * 1. Add an entry here (`basePath`: `/platform/<slug>`, plus `entry` URL)
 * 2. Register the lazy loader in `src/router/index.tsx` `remoteAppLoaders`
 * (No rspack.config change needed — remotes are registered at runtime.)
 */
export interface MfeEntry {
  id: string;
  title: string;
  /** Host-mounted path, no trailing slash — e.g. `/platform/admin` */
  basePath: string;
  remoteName: string;
  exposeKey: string;
  /** Module Federation v2 manifest URL (per-env, injected at build time). */
  entry: string;
}

// Baked in at build time via rspack DefinePlugin; falls back to local dev URLs.
declare const process: {
  env: { MFE_ADMIN_ENTRY_URL?: string; MFE_CHAT_ENTRY_URL?: string };
};

export const registry: MfeEntry[] = [
  {
    id: "admin",
    title: "后台管理",
    basePath: "/platform/admin",
    remoteName: "mfe_admin",
    exposeKey: "./App",
    entry:
      process.env.MFE_ADMIN_ENTRY_URL ??
      "http://localhost:3001/mf-manifest.json",
  },
  {
    id: "chat",
    title: "对话",
    basePath: "/platform/chat",
    remoteName: "mfe_chat",
    exposeKey: "./App",
    entry:
      process.env.MFE_CHAT_ENTRY_URL ??
      "http://localhost:3005/mf-manifest.json",
  },
  // { id: "scene", title: "场景", basePath: "/platform/scene", remoteName: "mfe_scene", exposeKey: "./App", entry: ... },
];

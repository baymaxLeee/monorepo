/**
 * Runtime app registry (replaces the old hard-coded `registry.ts`).
 *
 * The catalog of apps/products is owned by the admin service and fetched per
 * user: `GET /api/admin-server/apps` returns exactly the apps the current user
 * may mount (server-side filtered by user type — admin sees all, normal users
 * see only enabled, non-admin-only apps). The platform then dynamically
 * registers those remotes and drives nav + routing from the result.
 */
import { registerRemotes } from "@module-federation/enhanced/runtime";
import { type AppEntry, fetchApps } from "api";
import { create } from "zustand";

export type { AppEntry } from "api";

type AppsState = {
  apps: AppEntry[];
  loaded: boolean;
  error: string | null;
  setApps: (apps: AppEntry[]) => void;
  setError: (error: string) => void;
  reset: () => void;
};

export const useAppsStore = create<AppsState>((set) => ({
  apps: [],
  loaded: false,
  error: null,
  setApps: (apps) => set({ apps, loaded: true, error: null }),
  setError: (error) => set({ error, loaded: true }),
  reset: () => set({ apps: [], loaded: false, error: null }),
}));

let loadPromise: Promise<void> | null = null;

/**
 * Fetch the entitled apps once (cached), register their remotes with the MF
 * runtime, and populate the store. Safe to call from multiple places; the
 * shared promise dedupes concurrent callers and resolves the nav/route race.
 */
export function loadApps(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = fetchApps()
    .then((apps) => {
      // The admin service already returns exactly the apps this user may mount
      // (server-side filtered by user type). Trust it — no client-side filter.
      registerRemotes(
        apps.map((app) => ({ name: app.remote_name, entry: app.entry })),
        { force: true },
      );
      useAppsStore.getState().setApps(apps);
    })
    .catch((error) => {
      useAppsStore
        .getState()
        .setError(error instanceof Error ? error.message : String(error));
    });
  return loadPromise;
}

/** Clear cache on logout so the next user re-fetches their own entitlements. */
export function resetApps(): void {
  loadPromise = null;
  useAppsStore.getState().reset();
}

/** Module specifier for `loadRemote`, derived from the app's expose key. */
export function remoteModuleId(app: AppEntry): string {
  const expose = app.expose_key.replace(/^\.\//, "") || "App";
  return `${app.remote_name}/${expose}`;
}

// Runtime app registry: the catalog is owned by the admin service and fetched
// per user (GET /api/admin-server/apps, server-side filtered by user type).
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

// Cached so concurrent callers (App effect + RemoteHost) dedupe and the
// nav/route race resolves once.
export function loadApps(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = fetchApps()
    .then((apps) => {
      // Server already filtered to this user's apps; no client-side filter.
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

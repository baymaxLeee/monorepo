import { registerRemotes } from "@module-federation/enhanced/runtime";
import { type AppEntry, fetchApps } from "api";
import { getErrorMessage } from "shared";
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

function remoteEntry(entry: string): string {
  const url = new URL(entry, globalThis.location.origin);
  if (url.origin !== globalThis.location.origin) {
    throw new Error(`Remote entry must be same-origin: ${entry}`);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function loadApps(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = fetchApps({ skipErrorNotify: true })
    .then((apps) => {
      registerRemotes(
        apps.map((app) => ({
          name: app.remote_name,
          entry: remoteEntry(app.entry),
        })),
        { force: true },
      );
      useAppsStore.getState().setApps(apps);
    })
    .catch((error) => {
      useAppsStore.getState().setError(getErrorMessage(error));
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

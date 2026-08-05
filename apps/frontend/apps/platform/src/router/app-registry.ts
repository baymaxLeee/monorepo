import { registerRemotes } from "@module-federation/enhanced/runtime";
import { type AppEntry, fetchApps } from "@repo/api";

export type { AppEntry } from "@repo/api";

let loadPromise: Promise<AppEntry[]> | null = null;

function remoteEntry(entry: string): string {
  const url = new URL(entry, globalThis.location.origin);
  if (url.origin !== globalThis.location.origin) {
    throw new Error(`Remote entry must be same-origin: ${entry}`);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function loadApps(): Promise<AppEntry[]> {
  if (loadPromise) {
    return loadPromise;
  }

  const request = fetchApps({ skipErrorNotify: true })
    .then((apps) => {
      registerRemotes(
        apps.map((app) => ({
          name: app.remote_name,
          entry: remoteEntry(app.entry),
        })),
      );
      return apps;
    })
    .catch((error) => {
      if (loadPromise === request) {
        loadPromise = null;
      }
      throw error;
    });
  loadPromise = request;
  return request;
}

export function remoteModuleId(app: AppEntry): string {
  const expose = app.expose_key.replace(/^\.\//, "") || "routes";
  return `${app.remote_name}/${expose}`;
}

/**
 * Async bootstrap boundary.
 *
 * `main.tsx` does nothing but `import("./bootstrap")`. That dynamic import is
 * the Module Federation async boundary: by the time this module runs, the host
 * has initialized the shared scope, so React / Router / Zustand / platform
 * runtime are served as shared (no eager copies baked into the host main chunk,
 * no `mf-eager-anchors` needed).
 */
import "components/styles.css";

import { initObservability, installWebVitals } from "observability";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Baked in at build time via rspack DefinePlugin.
declare const process: {
  env: {
    API_BASE_URL?: string;
    TELEMETRY_ENDPOINT?: string;
    APP_RELEASE?: string;
  };
};

const telemetryPath =
  process.env.TELEMETRY_ENDPOINT ?? "/api/telemetry-server/rum/batch";
const apiBase = process.env.API_BASE_URL ?? "";
const telemetryEndpoint =
  apiBase && telemetryPath.startsWith("/")
    ? `${apiBase.replace(/\/$/, "")}${telemetryPath}`
    : telemetryPath;

initObservability({
  app: "platform",
  endpoint: telemetryEndpoint,
  release: process.env.APP_RELEASE ?? "dev",
});
installWebVitals();

// Remotes are no longer registered here: the entitled app catalog is owned by
// the admin service and fetched per user after login (see `apps.ts` / Layout),
// which registers exactly the remotes that user may mount.

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(<App />);

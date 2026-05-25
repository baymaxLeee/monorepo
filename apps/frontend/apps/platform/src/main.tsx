import "./mf-eager-anchors";
import "@packages/components/styles.css";

import { createRoot } from "react-dom/client";
import { initObservability, installWebVitals } from "@packages/observability";
import { App } from "./App";

// Both values are baked in at build time via rspack DefinePlugin.
// In cross-origin prod (Cloudflare → API), endpoint resolves to an absolute
// URL by combining process.env.API_BASE_URL + the relative telemetry path.
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

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(<App />);

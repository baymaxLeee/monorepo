import "./mf-eager-anchors";
import "@packages/components/styles.css";

import { createRoot } from "react-dom/client";
import { initObservability, installWebVitals } from "@packages/observability";
import { App } from "./App";

initObservability({
  app: "platform",
  endpoint: "/api/telemetry-server/rum/batch",
  release: "dev",
});
installWebVitals();

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(<App />);

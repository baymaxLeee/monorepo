// Shell (host) entry — direct sync bootstrap. NO async boundary.
//
// Why no `import("./bootstrap")`?
//   1. platform's rspack.config marks shared deps `eager: true`,
//      meaning they're bundled into the *initial* chunk and registered into
//      MF share-scope synchronously at startup.
//   2. Tree-shaking only keeps eager deps in the initial chunk if they're
//      statically reachable from the entry. With an async boundary the entry
//      doesn't statically reach React → it gets moved to a vendor chunk →
//      eager registration is bypassed → "factory is undefined" when the
//      vendor chunk's consume-shared fires before scope init.
//   3. Direct sync import keeps shared deps on the initial chunk, share-scope
//      is fully populated before any consume-shared call runs.
//
// (admin, the remote, still uses an async boundary in its main.tsx because
//  it needs scope init when running standalone with non-eager shared deps.)

// MUST be imported BEFORE anything that consumes shared deps.
// Pulls @packages/runtime, @packages/shared, @packages/auth-client (eager Tier2)
// flags in mf-shared.ts actually keep them in the initial chunk.
import "./mf-eager-anchors";
import "@packages/components/src/styles.css";

import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(<App />);

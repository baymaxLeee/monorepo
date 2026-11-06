import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Build output and development delivery share this explicit public asset list.
export const ARTIFACT_RUNTIME_ASSETS = [
  {
    url: "/runtime/echarts/6.1.0/echarts.min.js",
    file: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "node_modules/echarts/dist/echarts.min.js"),
    contentType: "application/javascript; charset=utf-8",
  },
];

export function setupArtifactRuntime(middlewares) {
  const bodies = new Map();
  const hostCheck = middlewares.findIndex((entry) => entry.name === "host-header-check");
  if (hostCheck < 0) throw new Error("Artifact runtime requires the dev server Host check");
  // These exact public assets are also served anonymously by production nginx.
  // Keep Host validation and the cross-site guard for every other request.
  middlewares.splice(hostCheck + 1, 0, {
    name: "artifact-runtime",
    middleware(req, res, next) {
      if (!["GET", "HEAD"].includes(req.method)) return next();
      const asset = ARTIFACT_RUNTIME_ASSETS.find((entry) => entry.url === req.url?.split("?")[0]);
      if (!asset) return next();
      try {
        const runtime = bodies.get(asset.url) ?? readFileSync(asset.file);
        bodies.set(asset.url, runtime);
        res.setHeader("Content-Type", asset.contentType);
        res.setHeader("Content-Length", runtime.length);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(req.method === "HEAD" ? undefined : runtime);
      } catch (error) {
        next(error);
      }
    },
  });
  return middlewares;
}

import { createRequire } from "node:module";
import path from "node:path";
import { frontendRoot, workspaceAliases } from "./workspace-aliases.mjs";

export { frontendRoot };

const require = createRequire(import.meta.url);
const cssLoader = require.resolve("css-loader");
const styleLoader = require.resolve("style-loader");

/**
 * Host-only: Tailwind v4 via @tailwindcss/webpack (no postcss.config).
 * Remotes must NOT register this rule — they consume CSS from platform.
 */
export function createHostCssRule({ loader = "style-loader" } = {}) {
  return {
    test: /\.css$/,
    use: [
      loader === "style-loader" ? styleLoader : loader,
      {
        loader: cssLoader,
        options: { importLoaders: 1 },
      },
      {
        loader: "@tailwindcss/webpack",
        options: { base: frontendRoot },
      },
    ],
    type: "javascript/auto",
  };
}

/**
 * Remote-only plain CSS support for lazy component chunks.
 * Do not run Tailwind here; remotes consume the host theme entry.
 */
export function createRemoteCssRule({ loader = "style-loader" } = {}) {
  return {
    test: /\.css$/,
    use: [
      loader === "style-loader" ? styleLoader : loader,
      {
        loader: cssLoader,
        options: { importLoaders: 0 },
      },
    ],
    type: "javascript/auto",
  };
}

/** App `src/` + workspace package entries (see workspace-aliases.mjs). */
export function createAppResolveAlias(appDir) {
  return {
    "@": path.resolve(appDir, "src"),
    ...workspaceAliases,
  };
}

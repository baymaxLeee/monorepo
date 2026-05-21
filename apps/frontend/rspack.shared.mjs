import path from "node:path";
import { frontendRoot, workspaceAliases } from "./workspace-aliases.mjs";

export { frontendRoot };

/**
 * Host-only: Tailwind v4 via @tailwindcss/webpack (no postcss.config).
 * Remotes must NOT register this rule — they consume CSS from platform.
 */
export function createHostCssRule() {
  return {
    test: /\.css$/,
    use: [
      "style-loader",
      {
        loader: "css-loader",
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

/** App `src/` + workspace package entries (see workspace-aliases.mjs). */
export function createAppResolveAlias(appDir) {
  return {
    "@": path.resolve(appDir, "src"),
    ...workspaceAliases,
  };
}

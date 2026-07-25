import { createRequire } from "node:module";
import path from "node:path";

import { frontendRoot, workspaceAliases } from "./workspace-aliases.mjs";

export { frontendRoot };

const require = createRequire(import.meta.url);
const cssLoader = require.resolve("css-loader");
const styleLoader = require.resolve("style-loader");

/**
 * Shared TS/TSX rule via Rspack's native SWC loader.
 *
 * React Compiler runs inside `builtin:swc-loader` (Rust port, Rspack ≥ 2.1) —
 * no Babel pass. On React 18 the compiled output imports the memoization cache
 * helper (`_c`) from the `react-compiler-runtime` polyfill, so pass
 * `reactCompiler: { target: "18" }` and keep that package installed + shared.
 *
 * @param {{ reactCompiler?: boolean | Record<string, unknown> }} [opts]
 */
export function createSwcRule({ reactCompiler = false } = {}) {
  return {
    test: /\.(t|j)sx?$/,
    exclude: /node_modules/,
    loader: "builtin:swc-loader",
    options: {
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        transform: {
          react: { runtime: "automatic" },
          ...(reactCompiler ? { reactCompiler } : {}),
        },
      },
    },
  };
}

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
    // pdfjs-dist's default build/pdf.mjs declares an internal
    // `__webpack_exports__`, which Rspack can shadow when wrapping the module.
    // The minified ESM build does not contain that internal webpack export var.
    "pdfjs-dist$": "pdfjs-dist/build/pdf.min.mjs",
    ...workspaceAliases,
  };
}

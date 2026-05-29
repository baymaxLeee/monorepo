import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { defineConfig } from "@rspack/cli";
import { buildShared } from "../../mf-shared.mjs";
import {
  createAppResolveAlias,
  createRemoteCssRule,
} from "../../rspack.shared.mjs";

const PORT = Number(process.env.PORT ?? 3001);
const appDir = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  entry: {},
  mode: isProduction ? "production" : "development",
  lazyCompilation: false,
  ignoreWarnings: [
    {
      module: /node_modules\/.pnpm\/sax@/,
      message: /Can't resolve 'stream'/,
    },
  ],
  output: {
    path: path.resolve(appDir, "dist"),
    publicPath: "auto",
    uniqueName: "mfe_admin",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: createAppResolveAlias(appDir),
  },
  module: {
    rules: [
      {
        test: /\.(t|j)sx?$/,
        exclude: /node_modules/,
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: { syntax: "typescript", tsx: true },
            transform: { react: { runtime: "automatic" } },
          },
        },
      },
      createRemoteCssRule(),
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: "mfe_admin",
      filename: "remoteEntry.js",
      // (c) emit .d.ts for exposes so the platform host can type `loadRemote`.
      // PRODUCTION BUILD ONLY — generating types under `rspack serve` writes
      // into a watched dir and triggers an HMR reload loop.
      dts: isProduction ? { generateTypes: true, consumeTypes: false } : false,
      // (d) match the host negotiation strategy.
      shareStrategy: "loaded-first",
      exposes: {
        "./App": "./src/App.tsx",
      },
      shared: buildShared("remote"),
    }),
  ],
  devServer: {
    port: PORT,
    historyApiFallback: {
      index: "/index.html",
    },
    headers: { "Access-Control-Allow-Origin": "*" },
    hot: true,
  },
});

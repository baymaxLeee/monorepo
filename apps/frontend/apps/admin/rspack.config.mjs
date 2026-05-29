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
    filename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
    chunkFilename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
    publicPath: "auto",
    uniqueName: "mfe_admin",
    clean: true,
  },
  optimization: {
    mangleExports: false,
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
      // No MF type generation: the host loads remotes dynamically via
      // `loadRemote` (cast), and shared/workspace types come from the pnpm
      // workspace + packages. MF dts adds no value in a single-repo setup.
      dts: false,
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

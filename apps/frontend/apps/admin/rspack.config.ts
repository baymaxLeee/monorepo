import path from "node:path";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import { defineConfig } from "@rspack/cli";
import { buildShared } from "../../mf-shared.mjs";

const PORT = Number(process.env.PORT ?? 3001);

export default defineConfig({
  entry: "./src/main.tsx",
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
  output: {
    path: path.resolve("dist"),
    publicPath: "auto",
    uniqueName: "mfe_admin",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: { "@": path.resolve("src") },
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
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
        type: "javascript/auto",
      },
    ],
  },
  plugins: [
    // Standalone HTML (for running this MFE in isolation during dev)
    new HtmlWebpackPlugin({ template: "./src/index.html" }),
    new ModuleFederationPlugin({
      name: "mfe_admin",
      filename: "remoteEntry.js",
      // Disable auto type-sharing for the demo (avoids dts-plugin noise).
      // Re-enable later by removing `dts: false` and following:
      // https://module-federation.io/guide/basic/type-prompt.html
      dts: false,
      exposes: {
        "./App": "./src/App.tsx",
      },
      // Shared-deps registry lives in apps/frontend/mf-shared.ts.
      // remote = NOT eager. When loaded by platform we consume platform's eager copies
      // from share-scope; standalone we init scope via the async boundary in
      // src/main.tsx (`import("./bootstrap")`).
      shared: buildShared("remote"),
    }),
  ],
  devServer: {
    port: PORT,
    historyApiFallback: true,
    headers: { "Access-Control-Allow-Origin": "*" },
    hot: true,
  },
});

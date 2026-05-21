import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import { defineConfig } from "@rspack/cli";
import { buildShared } from "../../mf-shared.mjs";
import { createAppResolveAlias } from "../../rspack.shared.mjs";

const PORT = Number(process.env.PORT ?? 3001);
const appDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: "./src/main.tsx",
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
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
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: "./src/index.html" }),
    new ModuleFederationPlugin({
      name: "mfe_admin",
      filename: "remoteEntry.js",
      dts: false,
      exposes: {
        "./App": "./src/App.tsx",
      },
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

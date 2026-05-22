import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import { defineConfig } from "@rspack/cli";
import { buildShared } from "../../mf-shared.mjs";
import {
  createAppResolveAlias,
  createHostCssRule,
} from "../../rspack.shared.mjs";

const PORT = Number(process.env.PORT ?? 3000);
const API_TARGET = process.env.API_TARGET ?? "http://localhost:8000";
const appDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: "./src/main.tsx",
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
  output: {
    path: path.resolve(appDir, "dist"),
    publicPath: "auto",
    uniqueName: "platform",
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
      createHostCssRule(),
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: "./src/index.html", publicPath: "/" }),
    new ModuleFederationPlugin({
      name: "platform",
      dts: false,
      remotes: {
        mfe_admin: `mfe_admin@http://localhost:3001/mf-manifest.json`,
      },
      shared: buildShared("host"),
    }),
  ],
  devServer: {
    port: PORT,
    historyApiFallback: {
      index: "/index.html",
      disableDotRule: true,
    },
    headers: { "Access-Control-Allow-Origin": "*" },
    hot: true,
    // Same-origin proxy so the browser never preflights /api/* in dev.
    // Production should mirror this via nginx / ingress.
    proxy: [
      {
        context: ["/api"],
        target: API_TARGET,
        changeOrigin: true,
        secure: false,
      },
    ],
  },
});

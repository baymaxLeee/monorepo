import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import HtmlWebpackPlugin from "html-webpack-plugin";
import { buildShared } from "../../mf-shared.mjs";
import {
  createAppResolveAlias,
  createHostCssRule,
} from "../../rspack.shared.mjs";

const PORT = Number(process.env.PORT ?? 3000);
const API_TARGET = process.env.API_TARGET ?? "http://localhost:8000";
const appDir = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

const API_BASE_URL = process.env.API_BASE_URL ?? "";
if (isProduction && !API_BASE_URL) {
  console.warn(
    "[rspack] API_BASE_URL is empty for a production build — assuming " +
      "same-origin (single-vps style). Set API_BASE_URL=https://api.x.com " +
      "if you intend a cross-origin deployment.",
  );
}

export default defineConfig({
  entry: "./src/main.tsx",
  mode: isProduction ? "production" : "development",
  lazyCompilation: false,
  output: {
    path: path.resolve(appDir, "dist"),
    filename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
    chunkFilename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
    publicPath: "auto",
    uniqueName: "platform",
    clean: true,
  },
  optimization: {
    splitChunks: {
      chunks: "all",
      maxSize: 500 * 1024,
      cacheGroups: {
        framework: {
          test: /[\\/]node_modules[\\/](?:react|react-dom|react-router|react-router-dom|scheduler|zustand|use-sync-external-store)[\\/]/,
          name: "framework",
          priority: 40,
          reuseExistingChunk: true,
        },
      },
    },
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
      createHostCssRule({
        loader: isProduction
          ? rspack.CssExtractRspackPlugin.loader
          : "style-loader",
      }),
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: "./src/index.html", publicPath: "/" }),
    new rspack.DefinePlugin({
      "process.env.API_BASE_URL": JSON.stringify(API_BASE_URL),
      "process.env.TELEMETRY_ENDPOINT": JSON.stringify(
        process.env.TELEMETRY_ENDPOINT ?? "/api/telemetry-server/rum/batch",
      ),
      "process.env.APP_RELEASE": JSON.stringify(
        process.env.APP_RELEASE ?? (isProduction ? "unknown" : "dev"),
      ),
    }),
    ...(isProduction
      ? [
          new rspack.CssExtractRspackPlugin({
            filename: "[name].[contenthash:8].css",
            chunkFilename: "[name].[contenthash:8].css",
          }),
        ]
      : []),
    new ModuleFederationPlugin({
      name: "platform",
      dts: false,
      shareStrategy: "loaded-first",
      shared: buildShared("host"),
    }),
  ],
  devServer: {
    port: PORT,
    historyApiFallback: {
      index: "/index.html",
    },
    headers: { "Access-Control-Allow-Origin": "*" },
    hot: true,
    compress: false,
    proxy: [
      {
        context: ["/api"],
        target: API_TARGET,
        changeOrigin: true,
        secure: false,
        ws: false,
        selfHandleResponse: false,
      },
      {
        context: ["/mfe-admin"],
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
        pathRewrite: { "^/mfe-admin": "" },
      },
      {
        context: ["/mfe-chat"],
        target: "http://localhost:3005",
        changeOrigin: true,
        secure: false,
        pathRewrite: { "^/mfe-chat": "" },
      },
    ],
  },
});

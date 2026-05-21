import path from "node:path";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import { defineConfig } from "@rspack/cli";
import { buildShared } from "../../mf-shared.mjs";

const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  entry: "./src/main.tsx",
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
  output: {
    path: path.resolve("dist"),
    publicPath: "auto",
    uniqueName: "platform",
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
    new HtmlWebpackPlugin({ template: "./src/index.html" }),
    new ModuleFederationPlugin({
      name: "platform",
      // Disable auto type-sharing for the demo (avoids dts-plugin noise).
      dts: false,
      remotes: {
        mfe_admin: `mfe_admin@http://localhost:3001/mf-manifest.json`,
      },
      // Shared-deps registry lives in apps/frontend/mf-shared.ts.
      // host = eager (bundled into initial chunk, share-scope registered sync at startup).
      shared: buildShared("host"),
    }),
  ],
  devServer: {
    port: PORT,
    historyApiFallback: true,
    headers: { "Access-Control-Allow-Origin": "*" },
    hot: true,
  },
});

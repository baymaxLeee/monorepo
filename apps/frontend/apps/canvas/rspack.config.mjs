import path from "node:path";
import { fileURLToPath } from "node:url";

import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { buildShared } from "@repo/build-config/mf-shared";
import { createAppResolveAlias, createRemoteCssRule, createSwcRule } from "@repo/build-config/rspack";
import { defineConfig } from "@rspack/cli";

const PORT = Number(process.env.PORT ?? 3006);
const appDir = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  entry: {},
  mode: isProduction ? "production" : "development",
  lazyCompilation: false,
  output: {
    path: path.resolve(appDir, "dist"),
    filename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
    chunkFilename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
    publicPath: "auto",
    uniqueName: "mfe_canvas",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: createAppResolveAlias(appDir),
  },
  module: {
    rules: [
      createSwcRule({ reactCompiler: { target: "19" } }),
      createRemoteCssRule(),
      {
        ...createRemoteCssRule(),
        test: /\.less$/,
        use: [
          createRemoteCssRule().use[0],
          {
            ...createRemoteCssRule().use[1],
            options: { importLoaders: 1, modules: { auto: true, namedExport: false } },
          },
          "less-loader",
        ],
      },
      { test: /\.(png|jpe?g|webp|svg|pdf)$/, type: "asset/resource" },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: "mfe_canvas",
      filename: "remoteEntry.js",
      dts: false,
      shareStrategy: "loaded-first",
      exposes: {
        "./routes": "./src/router/index.tsx",
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

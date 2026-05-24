import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import rspack from "@rspack/core";
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
const frontendRoot = path.resolve(appDir, "../..");
const isProduction = process.env.NODE_ENV === "production";

function isPackageModule(module, packageName) {
  return module.resource?.includes(
    `${path.sep}node_modules${path.sep}${packageName}${path.sep}`,
  );
}

function isWorkspacePackage(module, packageName) {
  return module.resource?.startsWith(
    path.join(frontendRoot, "packages", packageName, "src"),
  );
}

export default defineConfig({
  entry: "./src/main.tsx",
  mode: isProduction ? "production" : "development",
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
      minSize: 30 * 1024,
      maxInitialRequests: 8,
      maxAsyncRequests: 12,
      cacheGroups: {
        default: false,
        defaultVendors: false,
        framework: {
          test: (module) =>
            ["react", "react-dom", "react-router", "react-router-dom"].some(
              (pkg) => isPackageModule(module, pkg),
            ),
          name: "framework",
          priority: 50,
          enforce: true,
        },
        workspace: {
          test: (module) =>
            ["components", "runtime", "shared"].some((pkg) =>
              isWorkspacePackage(module, pkg),
            ),
          name: "workspace",
          priority: 40,
          enforce: true,
        },
        radixVendor: {
          test: (module) =>
            ["@radix-ui", "radix-ui"].some((pkg) =>
              isPackageModule(module, pkg),
            ),
          name: "radix-vendor",
          priority: 34,
          enforce: true,
        },
        uiVendor: {
          test: (module) =>
            [
              "sonner",
              "class-variance-authority",
              "clsx",
              "tailwind-merge",
            ].some((pkg) => isPackageModule(module, pkg)),
          name: "ui-vendor",
          priority: 30,
          enforce: true,
        },
        validationVendor: {
          test: (module) =>
            ["@hookform/resolvers", "zod"].some((pkg) =>
              isPackageModule(module, pkg),
            ),
          name: "validation-vendor",
          priority: 21,
          enforce: true,
        },
        formVendor: {
          test: (module) =>
            ["react-hook-form"].some((pkg) => isPackageModule(module, pkg)),
          name: "form-vendor",
          priority: 20,
          enforce: true,
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

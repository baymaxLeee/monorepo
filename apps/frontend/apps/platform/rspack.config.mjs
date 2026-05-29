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
const frontendRoot = path.resolve(appDir, "../..");
const isProduction = process.env.NODE_ENV === "production";

const API_BASE_URL = process.env.API_BASE_URL ?? "";
if (isProduction && !API_BASE_URL) {
  console.warn(
    "[rspack] API_BASE_URL is empty for a production build — assuming " +
      "same-origin (single-vps style). Set API_BASE_URL=https://api.x.com " +
      "if you intend a cross-origin deployment.",
  );
}

const MFE_ADMIN_ENTRY =
  process.env.MFE_ADMIN_ENTRY ??
  (isProduction
    ? "mfe_admin@/mfe-admin/mf-manifest.json"
    : "mfe_admin@http://localhost:3001/mf-manifest.json");

const MFE_CHAT_ENTRY =
  process.env.MFE_CHAT_ENTRY ??
  (isProduction
    ? "mfe_chat@/mfe-chat/mf-manifest.json"
    : "mfe_chat@http://localhost:3005/mf-manifest.json");

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
    new rspack.DefinePlugin({
      "process.env.API_BASE_URL": JSON.stringify(API_BASE_URL),
      "process.env.TELEMETRY_ENDPOINT": JSON.stringify(
        process.env.TELEMETRY_ENDPOINT ?? "/api/telemetry-server/rum/batch",
      ),
      "process.env.APP_RELEASE": JSON.stringify(
        process.env.APP_RELEASE ?? (isProduction ? "unknown" : "dev"),
      ),
      // Manifest URLs (no `name@` prefix) consumed by registry.ts at runtime.
      "process.env.MFE_ADMIN_ENTRY_URL": JSON.stringify(
        MFE_ADMIN_ENTRY.split("@").slice(1).join("@"),
      ),
      "process.env.MFE_CHAT_ENTRY_URL": JSON.stringify(
        MFE_CHAT_ENTRY.split("@").slice(1).join("@"),
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
      // PRODUCTION BUILD ONLY. In `rspack serve` the dts plugin writes consumed
      // remote types into a watched `@mf-types` dir, which retriggers compile →
      // HMR → full reload → re-fetch types → … an infinite dev reload loop.
      // Dev stays untyped (router casts loadRemote results); types sync only at
      // build time.
      dts: isProduction ? { consumeTypes: true, generateTypes: false } : false,
      shareStrategy: "loaded-first",
      runtimePlugins: [path.resolve(appDir, "src/mf-runtime-plugin.ts")],
      remotes: {
        mfe_admin: MFE_ADMIN_ENTRY,
        mfe_chat: MFE_CHAT_ENTRY,
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
    ],
  },
});

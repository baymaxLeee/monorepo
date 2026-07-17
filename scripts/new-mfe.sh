#!/usr/bin/env bash
set -euo pipefail

NAME="${1:?Usage: new-mfe.sh <name> (e.g. reports)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MFE_DIR="$ROOT/apps/frontend/apps/$NAME"

if [[ ! "$NAME" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "✗ name must be a lowercase app slug" >&2
  exit 1
fi

if [ -d "$MFE_DIR" ]; then
  echo "✗ already exists: $MFE_DIR" >&2
  exit 1
fi

REMOTE_NAME="mfe_${NAME//-/_}"
ROUTE_ID="${NAME//-/_}"

mkdir -p "$MFE_DIR/src/pages/home" "$MFE_DIR/src/router"

cat > "$MFE_DIR/AGENTS.md" <<EOF
# $NAME

## Boundaries

- Owns routes below \`/platform/$NAME\`.
- Must not import from another app under \`apps/frontend/apps/\`.
- Exposes \`./routes\` from \`src/router/index.tsx\`.
- The platform owns the only \`RouterProvider\`; this remote exports relative \`RouteObject[]\` only.

## Module Federation

- Remote name: \`$REMOTE_NAME\`
- Shared dependencies: \`buildShared("remote")\`
- Register the app through the admin app registry with expose key \`./routes\`.
EOF

cat > "$MFE_DIR/package.json" <<EOF
{
  "name": "$NAME",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "rspack serve",
    "build": "rspack build",
    "lint": "biome check src",
    "format": "biome check --write src",
    "typecheck": "node node_modules/@typescript/native/bin/tsc --noEmit"
  },
  "dependencies": {
    "components": "workspace:*",
    "react": "catalog:",
    "react-compiler-runtime": "catalog:",
    "react-dom": "catalog:",
    "react-router-dom": "catalog:"
  },
  "devDependencies": {
    "@module-federation/enhanced": "catalog:",
    "@rspack/cli": "catalog:",
    "@rspack/core": "catalog:",
    "@rspack/dev-server": "catalog:",
    "@swc/helpers": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@typescript/native": "catalog:",
    "typescript": "catalog:"
  }
}
EOF

cat > "$MFE_DIR/tsconfig.json" <<EOF
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"]
}
EOF

cat > "$MFE_DIR/rspack.config.mjs" <<'EOF'
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { defineConfig } from "@rspack/cli";
import { buildShared } from "../../mf-shared.mjs";
import {
  createAppResolveAlias,
  createRemoteCssRule,
  createSwcRule,
} from "../../rspack.shared.mjs";

const PORT = Number(process.env.PORT ?? 3099);
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
    uniqueName: "__REMOTE_NAME__",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: createAppResolveAlias(appDir),
  },
  module: {
    rules: [
      createSwcRule({ reactCompiler: { target: "18" } }),
      createRemoteCssRule(),
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: "__REMOTE_NAME__",
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
    historyApiFallback: { index: "/index.html" },
    headers: { "Access-Control-Allow-Origin": "*" },
    hot: true,
  },
});
EOF

sed -i.bak "s/__REMOTE_NAME__/$REMOTE_NAME/g" "$MFE_DIR/rspack.config.mjs"
rm -f "$MFE_DIR/rspack.config.mjs.bak"

cat > "$MFE_DIR/src/router/index.tsx" <<EOF
import { TooltipProvider } from "components";
import { Navigate, Outlet, type RouteObject } from "react-router-dom";

function RemoteRoot() {
  return (
    <TooltipProvider>
      <Outlet />
    </TooltipProvider>
  );
}

export const routes: RouteObject[] = [
  {
    id: "$ROUTE_ID-root",
    Component: RemoteRoot,
    children: [
      { index: true, lazy: () => import("../pages/home") },
      { path: "*", element: <Navigate to="/404" replace /> },
    ],
  },
];
EOF

cat > "$MFE_DIR/src/pages/home/index.tsx" <<EOF
export function Component() {
  return <main className="p-6">$NAME</main>;
}
EOF

cat > "$MFE_DIR/src/types.d.ts" <<'EOF'
declare module "*.css";
EOF

echo "✓ Created $MFE_DIR"
echo
echo "Next:"
echo "  1. Pick a free dev port and add the app to Procfile.dev and dev URLs."
echo "  2. Register /platform/$NAME, $REMOTE_NAME, ./routes, and its manifest URL in the admin app registry."
echo "  3. Add deployment routing for the manifest and remote assets."
echo "  4. Run just install, just lint, and just build $NAME."

#!/usr/bin/env bash
# Scaffold a new micro-frontend under apps/frontend/apps/<name>.
#
# Generates a full Module Federation remote skeleton wired into the central
# shared-deps registry (apps/frontend/mf-shared.ts), so the new MFE
# automatically reuses the host's pre-loaded React + @packages/shared, @packages/runtime, @packages/auth-client, @packages/components, @packages/api-client platform packages.
set -euo pipefail

NAME="${1:?Usage: new-mfe.sh <name> (e.g. mfe-scene)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MFE_DIR="$ROOT/apps/frontend/apps/$NAME"

if [ -d "$MFE_DIR" ]; then
  echo "✗ already exists: $MFE_DIR" >&2
  exit 1
fi

MF_NAME="${NAME//-/_}"

mkdir -p "$MFE_DIR/src"

cat > "$MFE_DIR/AGENTS.md" <<EOF
# $NAME

(Document this MFE's domain, routes, exposed components.)

## Module Federation

- Remote name: \`$MF_NAME\`
- Exposes: \`./App\` (default export from \`src/App.tsx\`)
- Shared deps: from \`apps/frontend/mf-shared.ts\` via \`buildShared("remote")\`
- Standalone dev: \`pnpm dev\` (port assigned via PORT env)

To consume from platform: add \`$MF_NAME\` to platform's rspack remotes and registry.
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
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "runtime": "workspace:*",
    "shared": "workspace:*",
    "components": "workspace:*",
    "radix-ui": "^1.4.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.468.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "@module-federation/enhanced": "^2.4.0",
    "@rspack/cli": "^1.7.11",
    "@rspack/core": "^1.7.11",
    "@swc/helpers": "^0.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "html-webpack-plugin": "^5.6.0",
    "typescript": "^5.4.0"
  }
}
EOF

cat > "$MFE_DIR/tsconfig.json" <<EOF
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "baseUrl": "." },
  "include": ["src/**/*"]
}
EOF

cat > "$MFE_DIR/rspack.config.mjs" <<'EOF'
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import { defineConfig } from "@rspack/cli";
import { buildShared } from "../../mf-shared.mjs";
import { createAppResolveAlias } from "../../rspack.shared.mjs";

const PORT = Number(process.env.PORT ?? 3099);
const appDir = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  entry: "./src/main.tsx",
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
  output: {
    path: path.resolve(appDir, "dist"),
    publicPath: "auto",
    uniqueName: "__MF_NAME__",
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
      name: "__MF_NAME__",
      filename: "remoteEntry.js",
      // dts PRODUCTION BUILD ONLY: under `rspack serve` it writes into a watched
      // dir and causes an HMR reload loop.
      dts: isProduction ? { generateTypes: true, consumeTypes: false } : false,
      shareStrategy: "loaded-first",
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
EOF

sed -i.bak "s/__MF_NAME__/$MF_NAME/g" "$MFE_DIR/rspack.config.mjs" && rm -f "$MFE_DIR/rspack.config.mjs.bak"

cat > "$MFE_DIR/src/index.html" <<EOF
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>$NAME (standalone)</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
EOF

cat > "$MFE_DIR/src/main.tsx" <<'EOF'
// Async boundary required for standalone mode.
// When loaded by platform (federated), this file is NOT used — platform calls
// directly into ./App via Module Federation. The boundary only matters when
// running this MFE on its own dev port.
import("./bootstrap");
EOF

cat > "$MFE_DIR/src/bootstrap.tsx" <<'EOF'
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
EOF

cat > "$MFE_DIR/src/App.tsx" <<EOF
export default function App() {
  return <div style={{ padding: 24 }}>$NAME placeholder</div>;
}
EOF

cat > "$MFE_DIR/src/types.d.ts" <<'EOF'
/* Tailwind globals are injected by platform host — no CSS in MFE. */
EOF

echo "✓ Created $MFE_DIR"
echo ""
echo "Next:"
echo "  1. Add to apps/frontend/apps/platform/src/registry.ts (single source):"
echo "       { id, title, basePath, remoteName: '$MF_NAME', exposeKey: './App',"
echo "         entry: process.env.MFE_<NAME>_ENTRY_URL ?? 'http://localhost:<port>/mf-manifest.json' }"
echo "     and register the loader in src/router/index.tsx remoteAppLoaders:"
echo "       $MF_NAME: () => loadRemote('$MF_NAME/App')"
echo "  2. (Optional, for build-time types) add $MF_NAME to platform rspack.config.mjs"
echo "     remotes + a MFE_<NAME>_ENTRY_URL DefinePlugin entry."
echo "  3. Pick a free port in apps/frontend/justfile PORTS map"
echo "  4. Add to root Procfile.dev so 'just dev' starts it"
echo "  5. Add k8s manifests: infra/k8s/base/$NAME/"

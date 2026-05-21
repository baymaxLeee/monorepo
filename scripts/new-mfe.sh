#!/usr/bin/env bash
# Scaffold a new micro-frontend under apps/frontend/apps/<name>.
#
# Generates a full Module Federation remote skeleton wired into the central
# shared-deps registry (apps/frontend/mf-shared.ts), so the new MFE
# automatically reuses the host's pre-loaded React + @app/* platform packages.
set -euo pipefail

NAME="${1:?Usage: new-mfe.sh <name> (e.g. mfe-scene)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MFE_DIR="$ROOT/apps/frontend/apps/$NAME"

if [ -d "$MFE_DIR" ]; then
  echo "✗ already exists: $MFE_DIR" >&2
  exit 1
fi

# snake_case name for Module Federation (rspack remote name)
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

To consume from shell: add \`$MF_NAME\` to shell's rspack remotes and registry.
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
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@app/runtime": "workspace:*",
    "@app/shared": "workspace:*",
    "@app/ui-kit": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@module-federation/enhanced": "^0.8.0",
    "@rspack/cli": "^1.0.0",
    "@rspack/core": "^1.0.0",
    "@swc/helpers": "^0.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "html-webpack-plugin": "^5.6.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
EOF

cat > "$MFE_DIR/tsconfig.json" <<EOF
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "baseUrl": "." },
  "include": ["src/**/*", "rspack.config.ts"]
}
EOF

cat > "$MFE_DIR/rspack.config.ts" <<'EOF'
import path from "node:path";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import { defineConfig } from "@rspack/cli";
import { buildShared } from "../../mf-shared.mjs";

const PORT = Number(process.env.PORT ?? 3099);

export default defineConfig({
  entry: "./src/main.tsx",
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
  output: {
    path: path.resolve("dist"),
    publicPath: "auto",
    uniqueName: "__MF_NAME__",
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
      name: "__MF_NAME__",
      filename: "remoteEntry.js",
      dts: false,
      exposes: {
        "./App": "./src/App.tsx",
      },
      // remote = NOT eager. Federated: consume host's eager copies.
      // Standalone: async boundary in src/main.tsx inits scope before consume.
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

# Substitute MF name placeholder
sed -i.bak "s/__MF_NAME__/$MF_NAME/g" "$MFE_DIR/rspack.config.ts" && rm "$MFE_DIR/rspack.config.ts.bak"

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
// When loaded by shell (federated), this file is NOT used — shell calls
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

echo "✓ Created $MFE_DIR"
echo ""
echo "Next:"
echo "  1. Add to apps/frontend/apps/shell/rspack.config.ts remotes:"
echo "       $MF_NAME: \`$MF_NAME@http://localhost:<port>/mf-manifest.json\`"
echo "  2. Add to apps/frontend/apps/shell/src/registry.ts"
echo "  3. Pick a free port in apps/frontend/justfile PORTS map"
echo "  4. Add to root Procfile.dev so 'just dev' starts it"
echo "  5. Add k8s manifests: infra/k8s/base/$NAME/"

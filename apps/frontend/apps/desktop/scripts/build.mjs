import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { rspack } from "@rspack/core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, "dist"), { recursive: true });
const entries = ["main", "preload", "runtime-worker", "file-worker"];
const compiler = rspack({
  context: root,
  mode: "production",
  target: "node",
  devtool: false,
  entry: Object.fromEntries(entries.map((name) => [name, `./electron/${name}.ts`])),
  output: { path: path.join(root, "dist"), filename: "[name].cjs", library: { type: "commonjs2" } },
  resolve: { extensions: [".ts", ".js", ".json"], extensionAlias: { ".js": [".ts", ".js"] } },
  externals: { electron: "commonjs electron", "node:sqlite": "commonjs node:sqlite" },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: "builtin:swc-loader",
        options: { jsc: { parser: { syntax: "typescript" }, target: "es2023" } },
      },
    ],
  },
  optimization: { minimize: false },
});
await new Promise((resolve, reject) => {
  compiler.run((error, stats) => {
    compiler.close((closeError) => {
      if (error || closeError || stats?.hasErrors())
        reject(error ?? closeError ?? new Error(stats.toString({ all: false, errors: true })));
      else {
        console.log(stats?.toString({ all: false, timings: true }));
        resolve();
      }
    });
  });
});
if (process.platform === "darwin") {
  execFileSync(
    "/usr/bin/xcrun",
    [
      "clang",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      path.join(root, "native/supervisor.c"),
      "-o",
      path.join(root, "dist/supervisor"),
    ],
    { stdio: "inherit" },
  );
} else {
  console.log("Native macOS supervisor is built only on macOS; local execution is unavailable on this platform.");
}

import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packager } from "@electron/packager";

if (process.platform !== "darwin") throw new Error("The local execution package must be built and verified on macOS");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = new URL(process.env.DESKTOP_PLATFORM_URL ?? "http://localhost:3000");
if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
  throw new Error("Invalid DESKTOP_PLATFORM_URL");
if (process.argv.length > 2)
  throw new Error(
    "Usage: just desktop-package (development bundle); configure DESKTOP_PLATFORM_URL in the environment",
  );
await import("./build.mjs");
const staging = await mkdtemp(path.join(tmpdir(), "monorepo-desktop-package-"));
try {
  await cp(path.join(root, "dist"), path.join(staging, "dist"), { recursive: true });
  await writeFile(path.join(staging, "dist/platform.json"), JSON.stringify({ url: url.href }));
  await writeFile(
    path.join(staging, "package.json"),
    JSON.stringify({ name: "monorepo-desktop", version: "0.1.0", main: "dist/main.cjs" }),
  );
  const paths = await packager({
    dir: staging,
    name: "Monorepo",
    appBundleId: "com.monorepo.desktop",
    platform: "darwin",
    arch: process.arch,
    electronVersion: "45.3.1",
    out: path.join(root, "release"),
    overwrite: true,
    asar: false,
  });
  console.log(paths.join("\n"));
} finally {
  await rm(staging, { recursive: true, force: true });
}

import { execFile } from "node:child_process";
import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { packager } from "@electron/packager";

const execute = promisify(execFile);

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
  await writeFile(path.join(staging, "dist/platform.json"), JSON.stringify({ url: url.href, prompt: true }));
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
    osxSign: {
      identity: "-",
      identityValidation: false,
      optionsForFile: () => ({ hardenedRuntime: false }),
      continueOnError: false,
    },
  });
  const app = path.join(paths[0], "Monorepo.app");
  const { stderr: signature } = await execute("/usr/bin/codesign", ["-d", "--verbose=4", app]);
  if (/^CodeDirectory .*flags=.*\bruntime\b/m.test(signature))
    throw new Error("Development package unexpectedly enabled hardened runtime");
  await execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  const archive = path.join(root, "release", `Monorepo-darwin-${process.arch}.zip`);
  await rm(archive, { force: true });
  await execute("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
  console.log([...paths, archive].join("\n"));
} finally {
  await rm(staging, { recursive: true, force: true });
}

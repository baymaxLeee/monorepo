import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

const packageRoot = path.resolve(process.cwd(), "packages/api");
const services = ["iam", "admin", "chat", "knowledge", "telemetry", "canvas", "storage"];

it("preserves the published clients when generation fails", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "api-codegen-"));
  const fixturePackage = path.join(fixtureRoot, "apps/frontend/packages/api");
  const fixtureSchemas = path.join(fixtureRoot, "schemas/openapi");
  const fixtureBin = path.join(fixtureRoot, "bin");
  const sentinel = "// existing generated client\n";

  try {
    await Promise.all([
      mkdir(path.join(fixturePackage, "scripts"), { recursive: true }),
      mkdir(path.join(fixturePackage, "src"), { recursive: true }),
      mkdir(fixtureSchemas, { recursive: true }),
      mkdir(fixtureBin, { recursive: true }),
    ]);
    await copyFile(path.join(packageRoot, "scripts/codegen.sh"), path.join(fixturePackage, "scripts/codegen.sh"));
    await chmod(path.join(fixturePackage, "scripts/codegen.sh"), 0o755);
    await writeFile(path.join(fixturePackage, "src/orval-mutator.ts"), "export const apiMutator = () => {};\n");
    await Promise.all(
      services.flatMap((service) => [
        writeFile(path.join(fixtureSchemas, `${service}-server.json`), "{}\n"),
        writeFile(path.join(fixturePackage, "src", `${service}-server.ts`), sentinel),
      ]),
    );
    const fakePnpm = path.join(fixtureBin, "pnpm");
    await writeFile(fakePnpm, "#!/usr/bin/env bash\nexit 42\n");
    await chmod(fakePnpm, 0o755);

    const result = spawnSync("bash", [path.join(fixturePackage, "scripts/codegen.sh")], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fixtureBin}:${process.env.PATH ?? ""}` },
    });

    expect(result.status).toBe(42);
    await Promise.all(
      services.map(async (service) => {
        expect(await readFile(path.join(fixturePackage, "src", `${service}-server.ts`), "utf8")).toBe(sentinel);
      }),
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

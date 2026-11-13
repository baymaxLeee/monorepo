import assert from "node:assert/strict";
import test from "node:test";

import { parsePublishArgs, publishImages } from "./publish-images-local.mjs";

test("local publish builds exact HEAD and delays aliases until every immutable image", () => {
  const revision = "deadbeef" + "1".repeat(32);
  const options = parsePublishArgs(["registry.example.com/team", "sha-deadbeef", "chat", "web", "--alias", "main"]);
  const calls = [];
  const digests = new Map();
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (program === "git") {
      if (args[0] === "rev-parse") return { status: 0, stdout: `${revision}\n`, stderr: "" };
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "config") return { status: 0, stdout: "git@github.com:acme/app.git\n", stderr: "" };
      if (args[0] === "show") return { status: 0, stdout: "2026-11-13T12:00:00+08:00\n", stderr: "" };
    }
    if (args[0] === "buildx" && args[1] === "imagetools" && args[2] === "inspect") {
      const value = digests.get(args.at(-1));
      return { status: value ? 0 : 1, stdout: value ? `Digest:    ${value}\n` : "", stderr: "" };
    }
    if (args[0] === "buildx" && args[1] === "build") {
      const target = args[args.indexOf("--tag") + 1];
      digests.set(target, `sha256:${target.includes("/chat:") ? "a" : "b".repeat(64)}`);
      if (target.includes("/chat:")) digests.set(target, `sha256:${"a".repeat(64)}`);
    }
    if (args[0] === "buildx" && args[1] === "imagetools" && args[2] === "create")
      digests.set(args.at(-2), digests.get(args.at(-1)));
    return { status: 0, stdout: "", stderr: "" };
  };

  publishImages(options, run);

  const builds = calls.filter(([, first, second]) => first === "buildx" && second === "build");
  const firstAlias = calls.findIndex((call) => call.includes("registry.example.com/team/chat:main"));
  const lastBuild = Math.max(...builds.map((build) => calls.indexOf(build)));
  assert.equal(builds.length, 2);
  assert.ok(
    builds.every(
      (call) =>
        call.includes("linux/amd64") &&
        call.includes("--push") &&
        call.includes("GOPROXY=https://proxy.golang.com.cn") &&
        call.includes("GOSUMDB=sum.golang.google.cn") &&
        call.includes("DEBIAN_MIRROR=repo.huaweicloud.com") &&
        call.includes("NPM_CONFIG_REGISTRY=https://registry.npmjs.org") &&
        call.includes("COREPACK_NPM_REGISTRY=https://registry.npmjs.org"),
    ),
  );
  assert.ok(firstAlias > lastBuild);
});

test("local publish rejects a tag that does not identify current HEAD", () => {
  const options = parsePublishArgs(["registry.example.com/team", "sha-deadbeef", "chat"]);
  const run = (_program, args) => {
    if (args[0] === "rev-parse") return { status: 0, stdout: `${"cafebabe"}${"1".repeat(32)}\n`, stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  assert.throws(() => publishImages(options, run), /does not match current HEAD/);
});

test("local publish rejects unknown image services", () => {
  assert.throws(
    () => parsePublishArgs(["registry.example.com/team", "sha-deadbeef", "unknown"]),
    /Unknown image service/,
  );
});

test("exact sync compares source and target digests and delays aliases", () => {
  const revision = "deadbeef" + "1".repeat(32);
  const options = parsePublishArgs([
    "registry.example.com/team",
    "sha-deadbeef",
    "chat",
    "web",
    "--from",
    "ghcr.io/acme/app",
    "--alias",
    "main",
  ]);
  const calls = [];
  const digests = new Map([
    ["ghcr.io/acme/app/chat:sha-deadbeef", `sha256:${"a".repeat(64)}`],
    ["ghcr.io/acme/app/web:sha-deadbeef", `sha256:${"b".repeat(64)}`],
    ["registry.example.com/team/chat:sha-deadbeef", `sha256:${"a".repeat(64)}`],
  ]);
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (program === "git") {
      if (args[0] === "rev-parse") return { status: 0, stdout: `${revision}\n`, stderr: "" };
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "buildx" && args[1] === "imagetools" && args[2] === "inspect") {
      const value = digests.get(args.at(-1));
      return { status: value ? 0 : 1, stdout: value ? `Digest: ${value}\n` : "", stderr: "" };
    }
    if (args[0] === "buildx" && args[1] === "imagetools" && args[2] === "create")
      digests.set(args.at(-2), digests.get(args.at(-1)));
    return { status: 0, stdout: "", stderr: "" };
  };

  publishImages(options, run);

  const immutableCopies = calls.filter(
    (call) => call.includes("imagetools") && call.includes("create") && call.at(-2).endsWith(":sha-deadbeef"),
  );
  assert.equal(immutableCopies.length, 1);
  assert.equal(immutableCopies[0].at(-1), "ghcr.io/acme/app/web:sha-deadbeef");
  const firstAlias = calls.findIndex((call) => call.includes("registry.example.com/team/chat:main"));
  const immutableCopy = calls.indexOf(immutableCopies[0]);
  assert.ok(firstAlias > immutableCopy);
});

test("dry-run performs no Docker or registry operation", () => {
  const options = parsePublishArgs([
    "registry.example.com/team",
    "sha-deadbeef",
    "chat",
    "--from",
    "ghcr.io/acme/app",
    "--dry-run",
  ]);
  const calls = [];
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (args[0] === "rev-parse") return { status: 0, stdout: `${"deadbeef"}${"1".repeat(32)}\n`, stderr: "" };
    if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };

  publishImages(options, run);

  assert.ok(calls.every(([program]) => program === "git"));
});

test("exact sync rejects rebuild because source digest is authoritative", () => {
  assert.throws(
    () => parsePublishArgs(["registry.example.com/team", "sha-deadbeef", "--from", "ghcr.io/acme/app", "--rebuild"]),
    /cannot be combined/,
  );
});

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { images } from "./image-plan.mjs";

const knownImages = new Map(images.map((image) => [image.service, image]));
const referencePattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/;
const tagPattern = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$/;
const defaultTargetPrefix = "crpi-zfr29e2f63qt8nyh.cn-hangzhou.personal.cr.aliyuncs.com/baymaxlee";
const defaultSourcePrefix = "ghcr.io/baymaxleee/monorepo";

export function defaultPublishArgs(revision, args = []) {
  return [
    defaultTargetPrefix,
    `sha-${revision.slice(0, 8)}`,
    ...args,
    "--from",
    defaultSourcePrefix,
    "--alias",
    "main",
  ];
}

export function parsePublishArgs(args) {
  const aliases = [];
  const positional = [];
  let sourcePrefix = null;
  let dryRun = false;
  let rebuild = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--alias") {
      const alias = args[++index];
      if (!alias || !tagPattern.test(alias)) throw new Error("--alias requires a valid OCI tag");
      aliases.push(alias);
    } else if (args[index] === "--from") {
      sourcePrefix = args[++index];
      if (!sourcePrefix || !referencePattern.test(sourcePrefix))
        throw new Error("--from requires an OCI source prefix without credentials or shell syntax");
    } else if (args[index] === "--dry-run") dryRun = true;
    else if (args[index] === "--rebuild") rebuild = true;
    else if (args[index].startsWith("--")) throw new Error(`Unknown option: ${args[index]}`);
    else positional.push(args[index]);
  }

  const [targetPrefix, tag, ...requested] = positional;
  if (!targetPrefix || !tag)
    throw new Error(
      "Usage: just publish-images-local <target-prefix> <sha-tag> [services...] [--from <source-prefix>] [--alias <tag>] [--rebuild] [--dry-run]",
    );
  if (!referencePattern.test(targetPrefix))
    throw new Error("Target prefix must be an OCI reference without credentials or shell syntax");
  if (!tagPattern.test(tag) || !/^sha-[a-f0-9]{8}$/.test(tag))
    throw new Error("Immutable tag must use sha-<current-HEAD-8>");

  const services = requested.length > 0 ? requested : images.map(({ service }) => service);
  const unknown = services.filter((service) => !knownImages.has(service));
  if (unknown.length > 0) throw new Error(`Unknown image service(s): ${unknown.join(", ")}`);
  if (sourcePrefix && rebuild)
    throw new Error("--rebuild applies only to local builds and cannot be combined with --from");
  return {
    targetPrefix: targetPrefix.replace(/\/$/, ""),
    sourcePrefix: sourcePrefix?.replace(/\/$/, "") ?? null,
    tag,
    services: [...new Set(services)],
    aliases: [...new Set(aliases)].filter((alias) => alias !== tag),
    dryRun,
    rebuild,
  };
}

function command(program, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure)
    throw new Error(`${program} ${args[0]} failed with exit code ${result.status}`);
  return result;
}

function output(program, args, run) {
  return run(program, args, { capture: true }).stdout.trim();
}

function digest(reference, run) {
  const result = run("docker", ["buildx", "imagetools", "inspect", reference], {
    capture: true,
    allowFailure: true,
  });
  if (result.status !== 0) return null;
  return /^Digest:\s+(sha256:[a-f0-9]{64})$/m.exec(result.stdout)?.[1] ?? null;
}

function runWithRetries(program, args, run, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = run(program, args, { allowFailure: true });
    if (result.status === 0) return;
    if (attempt === attempts) throw new Error(`${program} ${args[0]} failed after ${attempts} attempts`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 2000);
  }
}

function validateRepository(options, run) {
  const revision = output("git", ["rev-parse", "HEAD"], run);
  const expectedTag = `sha-${revision.slice(0, 8)}`;
  if (options.tag !== expectedTag)
    throw new Error(`Tag ${options.tag} does not match current HEAD; expected ${expectedTag}`);
  if (output("git", ["status", "--porcelain"], run))
    throw new Error("Working tree must be clean so the image tag identifies its exact source");

  return revision;
}

function publishAliases(options, published, run) {
  for (const alias of options.aliases) {
    process.stdout.write(`→ publishing alias ${alias} after immutable set verification\n`);
    for (const [service, image] of published) {
      const targetAlias = `${options.targetPrefix}/${service}:${alias}`;
      if (digest(targetAlias, run) === image.digest) continue;
      runWithRetries(
        "docker",
        ["buildx", "imagetools", "create", "--prefer-index=false", "--tag", targetAlias, image.target],
        run,
      );
      if (digest(targetAlias, run) !== image.digest) throw new Error(`Alias digest mismatch for ${targetAlias}`);
    }
  }
}

function printDryRun(options, revision) {
  const action = options.sourcePrefix ? "sync exact digest" : options.rebuild ? "rebuild" : "build if absent";
  process.stdout.write(`dry-run: ${action} for ${options.tag} at HEAD ${revision.slice(0, 8)}\n`);
  for (const service of options.services) {
    const source = options.sourcePrefix ? `${options.sourcePrefix}/${service}:${options.tag} -> ` : "";
    process.stdout.write(`  ${source}${options.targetPrefix}/${service}:${options.tag}\n`);
  }
  for (const alias of options.aliases) process.stdout.write(`  alias after verification: ${alias}\n`);
}

function syncExactImages(options, run) {
  const published = new Map();
  let skipped = 0;
  let synced = 0;

  for (const service of options.services) {
    const source = `${options.sourcePrefix}/${service}:${options.tag}`;
    const target = `${options.targetPrefix}/${service}:${options.tag}`;
    const sourceDigest = digest(source, run);
    if (!sourceDigest) throw new Error(`Source image is unavailable: ${source}`);

    if (digest(target, run) !== sourceDigest) {
      process.stdout.write(`→ syncing ${service}:${options.tag} as exact digest ${sourceDigest}\n`);
      runWithRetries(
        "docker",
        ["buildx", "imagetools", "create", "--prefer-index=false", "--tag", target, source],
        run,
      );
      synced++;
    } else {
      process.stdout.write(`↷ skipping ${service}:${options.tag}; already matches ${sourceDigest}\n`);
      skipped++;
    }

    const targetDigest = digest(target, run);
    if (targetDigest !== sourceDigest)
      throw new Error(
        `Digest mismatch for ${target}: expected ${sourceDigest}, received ${targetDigest ?? "unavailable"}`,
      );
    process.stdout.write(`✓ ${service}:${options.tag} verified ${targetDigest}\n`);
    published.set(service, { target, digest: targetDigest });
  }

  publishAliases(options, published, run);
  process.stdout.write(`✓ exact image set verified: ${synced} synced, ${skipped} skipped, ${published.size} total\n`);
}

function buildLocalImages(options, revision, run) {
  const repository = output("git", ["config", "--get", "remote.origin.url"], run)
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  const created = output("git", ["show", "-s", "--format=%aI", "HEAD"], run);
  const goProxy = process.env.LOCAL_IMAGE_GOPROXY ?? "https://proxy.golang.com.cn";
  const goSumDb = process.env.LOCAL_IMAGE_GOSUMDB ?? "sum.golang.google.cn";
  const debianMirror = process.env.LOCAL_IMAGE_DEBIAN_MIRROR ?? "repo.huaweicloud.com";
  const npmRegistry = process.env.LOCAL_IMAGE_NPM_REGISTRY ?? "https://registry.npmjs.org";
  const corepackRegistry = process.env.LOCAL_IMAGE_COREPACK_NPM_REGISTRY ?? "https://registry.npmjs.org";
  const published = new Map();

  for (const service of options.services) {
    const image = knownImages.get(service);
    const target = `${options.targetPrefix}/${service}:${options.tag}`;
    const existing = digest(target, run);
    if (existing && !options.rebuild) {
      process.stdout.write(`✓ ${service}:${options.tag} already exists as ${existing}\n`);
      published.set(service, { target, digest: existing });
      continue;
    }

    process.stdout.write(`→ building ${service} from local HEAD ${revision.slice(0, 8)}\n`);
    runWithRetries(
      "docker",
      [
        "buildx",
        "build",
        "--progress",
        "plain",
        "--network",
        "host",
        "--platform",
        "linux/amd64",
        "--build-arg",
        `GOPROXY=${goProxy}`,
        "--build-arg",
        `GOSUMDB=${goSumDb}`,
        "--build-arg",
        `DEBIAN_MIRROR=${debianMirror}`,
        "--build-arg",
        `NPM_CONFIG_REGISTRY=${npmRegistry}`,
        "--build-arg",
        `COREPACK_NPM_REGISTRY=${corepackRegistry}`,
        "--file",
        image.dockerfile,
        "--tag",
        target,
        "--push",
        "--provenance=false",
        "--label",
        `org.opencontainers.image.source=${repository}`,
        "--label",
        `org.opencontainers.image.revision=${revision}`,
        "--label",
        `org.opencontainers.image.created=${created}`,
        image.context,
      ],
      run,
    );
    const targetDigest = digest(target, run);
    if (!targetDigest) throw new Error(`Published image is unavailable: ${target}`);
    process.stdout.write(`✓ ${service}:${options.tag} verified ${targetDigest}\n`);
    published.set(service, { target, digest: targetDigest });
  }

  publishAliases(options, published, run);
}

export function publishImages(options, run = command) {
  const revision = validateRepository(options, run);
  if (options.dryRun) {
    printDryRun(options, revision);
    return;
  }
  if (options.sourcePrefix) syncExactImages(options, run);
  else buildLocalImages(options, revision, run);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const publishArgs =
      args[0] === "--default" ? defaultPublishArgs(output("git", ["rev-parse", "HEAD"], command), args.slice(1)) : args;
    publishImages(parsePublishArgs(publishArgs));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

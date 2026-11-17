#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "patch", "head", "options", "trace"]);

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const targetName = args.get("--target");
const output = args.get("--output");
if (!targetName || !output) {
  throw new Error("usage: prepare-admin-server.mjs --target <name> --output <path>");
}

const root = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(
  await readFile(path.join(import.meta.dirname, "admin-server-codegen.json"), "utf8"),
);
const target = manifest[targetName];
if (!target) {
  throw new Error(`unknown Admin server target: ${targetName}`);
}

const source = await readFile(path.join(root, target.source), "utf8");
const document = JSON.parse(source);
const includeEveryOperation = target.operations === "*";
const expected = new Set(includeEveryOperation ? [] : target.operations);
const found = new Set();
const paths = {};

for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
  const selected = {};
  if (pathItem.parameters) selected.parameters = pathItem.parameters;
  for (const [method, operation] of Object.entries(pathItem)) {
    if (
      !HTTP_METHODS.has(method) ||
      !operation?.operationId ||
      (!includeEveryOperation && !expected.has(operation.operationId))
    )
      continue;
    if (found.has(operation.operationId)) throw new Error(`duplicate operationId: ${operation.operationId}`);
    found.add(operation.operationId);
    // oapi-codegen normalizes operationId values inside its embedded spec to
    // Go method names. Preserve the producer's stable codegen key so Admin's
    // Go exporter can restore it for non-Go consumers.
    if (target.preserveOperationIds === true) {
      operation["x-original-operation-id"] = operation.operationId;
    }
    selected[method] = operation;
  }
  if (Object.keys(selected).some((key) => HTTP_METHODS.has(key))) paths[route] = selected;
}

const missing = [...expected].filter((operation) => !found.has(operation));
if (missing.length > 0) throw new Error(`${targetName} references missing operationIds: ${missing.join(", ")}`);

document.paths = paths;
if (target.preserveInfo !== true) {
  document.info = { ...document.info, title: `${document.info?.title ?? targetName} ${targetName} client` };
}
document.components = reachableComponents(document);

if (target.embedCanonicalHash === true) {
  document["x-canonical-sha256"] = createHash("sha256").update(source).digest("hex");
}

if (target.language === "go") {
  document.openapi = "3.0.3";
  projectNullableSchema(document);
}

await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);

function reachableComponents(document) {
  const references = new Set();
  collectReferences(document.paths, references);
  const pending = [...references];
  for (let index = 0; index < pending.length; index += 1) {
    const reference = pending[index];
    const value = resolveReference(document, reference);
    const nested = new Set();
    collectReferences(value, nested);
    for (const child of nested) {
      if (references.has(child)) continue;
      references.add(child);
      pending.push(child);
    }
  }

  const components = {};
  for (const reference of references) {
    const match = reference.match(/^#\/components\/([^/]+)\/(.+)$/);
    if (!match) continue;
    const [, group, encodedName] = match;
    const name = decodePointer(encodedName);
    components[group] ??= {};
    components[group][name] = document.components?.[group]?.[name];
  }
  if (document.components?.securitySchemes) components.securitySchemes = document.components.securitySchemes;
  return components;
}

function collectReferences(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string" && child.startsWith("#/components/")) output.add(child);
    collectReferences(child, output);
  }
}

function resolveReference(document, reference) {
  return reference
    .slice(2)
    .split("/")
    .map(decodePointer)
    .reduce((value, segment) => value?.[segment], document);
}

function decodePointer(value) {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function projectNullableSchema(value) {
  if (Array.isArray(value)) {
    for (const item of value) projectNullableSchema(item);
    return;
  }
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value.anyOf)) {
    const concrete = value.anyOf.filter((schema) => schema?.type !== "null");
    const includesNull = concrete.length !== value.anyOf.length;
    if (includesNull) {
      if (concrete.length !== 1) throw new Error(`cannot project nullable anyOf: ${JSON.stringify(value.anyOf)}`);
      delete value.anyOf;
      Object.assign(value, concrete[0], { nullable: true });
    }
  }

  if (Array.isArray(value.type) && value.type.includes("null")) {
    const concrete = value.type.filter((type) => type !== "null");
    if (concrete.length !== 1) throw new Error(`cannot project nullable type union: ${JSON.stringify(value.type)}`);
    value.type = concrete[0];
    value.nullable = true;
  }

  // OpenAPI permits `nullable` next to a reference, but oapi-codegen ignores
  // sibling keywords on a bare $ref. Preserve the same schema through an
  // allOf wrapper so required nullable responses become Go pointers instead
  // of zero-valued structs on the wire.
  if (value.nullable === true && typeof value.$ref === "string") {
    const reference = value.$ref;
    delete value.$ref;
    value.allOf = [{ $ref: reference }];
  }

  for (const child of Object.values(value)) projectNullableSchema(child);
}

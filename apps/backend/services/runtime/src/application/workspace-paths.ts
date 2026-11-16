import { createHash } from "node:crypto";

const WORKSPACE_ROOT = "/workspace/";
const MAX_COMPONENT_BYTES = 255;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export interface LegacyWorkspaceFile {
  id: string;
  filename: string;
  createdAt: Date;
}

export interface WorkspacePathAllocation {
  id: string;
  workspacePath: string;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const next = utf8Bytes(character);
    if (bytes + next > maxBytes) break;
    result += character;
    bytes += next;
  }
  return result;
}

function idToken(id: string): string {
  if (SAFE_ID.test(id)) return id;
  return Buffer.from(id, "utf8").toString("hex");
}

function safeComponent(filename: string): string | null {
  const normalized = filename.normalize("NFC");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(normalized) ||
    utf8Bytes(normalized) > MAX_COMPONENT_BYTES
  ) {
    return null;
  }
  return normalized;
}

function fallbackName(id: string): string {
  const token = idToken(id);
  const candidate = `file~${token}`;
  if (utf8Bytes(candidate) <= MAX_COMPONENT_BYTES) return candidate;
  return `file~${createHash("sha256").update(id).digest("hex")}`;
}

function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot) } : { stem: name, extension: "" };
}

function compareLegacyFiles(left: LegacyWorkspaceFile, right: LegacyWorkspaceFile): number {
  const time = left.createdAt.getTime() - right.createdAt.getTime();
  return time || Buffer.compare(Buffer.from(left.id, "utf8"), Buffer.from(right.id, "utf8"));
}

function generatedName(baseName: string, id: string, reserved: Set<string>, assigned: Set<string>): string {
  const token = idToken(id);
  const { stem, extension } = splitExtension(baseName);
  for (let length = Math.min(8, token.length); length <= token.length; length += 1) {
    const suffix = `~${token.slice(0, length)}`;
    const stemBudget = MAX_COMPONENT_BYTES - utf8Bytes(extension) - utf8Bytes(suffix);
    if (stemBudget <= 0) break;
    const candidate = `${truncateUtf8(stem, stemBudget)}${suffix}${extension}`;
    if (candidate && !reserved.has(candidate) && !assigned.has(candidate)) return candidate;
  }

  for (let counter = 1; counter <= Number.MAX_SAFE_INTEGER; counter += 1) {
    const suffix = `~${token}~${counter}`;
    const stemBudget = MAX_COMPONENT_BYTES - utf8Bytes(extension) - utf8Bytes(suffix);
    if (stemBudget <= 0) break;
    const candidate = `${truncateUtf8(stem, stemBudget)}${suffix}${extension}`;
    if (candidate && !reserved.has(candidate) && !assigned.has(candidate)) return candidate;
  }

  const digestBase = `file~${createHash("sha256").update(id).digest("hex")}`;
  for (let counter = 0; ; counter += 1) {
    const suffix = counter === 0 ? "" : `~${counter}`;
    const candidate = `${truncateUtf8(digestBase, MAX_COMPONENT_BYTES - utf8Bytes(suffix))}${suffix}`;
    if (!reserved.has(candidate) && !assigned.has(candidate)) return candidate;
  }
}

export function allocateLegacyWorkspacePaths(files: readonly LegacyWorkspaceFile[]): WorkspacePathAllocation[] {
  const sorted = [...files].sort(compareLegacyFiles);
  const baseNames = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const file of sorted) {
    const baseName = safeComponent(file.filename) ?? fallbackName(file.id);
    baseNames.set(file.id, baseName);
    counts.set(baseName, (counts.get(baseName) ?? 0) + 1);
  }

  const reserved = new Set(baseNames.values());
  const assigned = new Set<string>();
  return sorted.map((file) => {
    const baseName = baseNames.get(file.id)!;
    const name =
      counts.get(baseName) === 1 && !assigned.has(baseName)
        ? baseName
        : generatedName(baseName, file.id, reserved, assigned);
    assigned.add(name);
    return { id: file.id, workspacePath: `${WORKSPACE_ROOT}${name}` };
  });
}

export function isValidWorkspacePath(path: string): boolean {
  if (!path.startsWith(WORKSPACE_ROOT)) return false;
  const relative = path.slice(WORKSPACE_ROOT.length);
  const parts = relative.split("/");
  return (
    parts.length > 0 &&
    parts.every(
      (part) =>
        part.length > 0 &&
        part !== "." &&
        part !== ".." &&
        part === part.normalize("NFC") &&
        !part.includes("\\") &&
        !/[\u0000-\u001f\u007f]/u.test(part) &&
        utf8Bytes(part) <= MAX_COMPONENT_BYTES,
    )
  );
}

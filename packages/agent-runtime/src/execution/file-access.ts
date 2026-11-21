import { isAbsolute, relative, resolve } from "node:path";

import { parseApplyPatch } from "../tools/files/patch/parser.js";
import { applyAdditionalPermissions, type PermissionProfile } from "./permissions.js";
import type { ProcessIdentity } from "./process-manager.js";

export type FileAccess = { path: string; access: "read" | "write" };

export type FileToolName = "read_file" | "apply_patch" | "write_file";

export interface FileSystemPolicy {
  workspaceRoot: string;
  workingDirectory: string;
  immutableWriteRoots?: string[];
  additionalReadRoots?: readonly string[];
}

export interface FileToolAuthority {
  accesses: FileAccess[];
  permissionProfile: PermissionProfile;
  process: ProcessIdentity;
  abortSignal: AbortSignal;
}

export class FilePolicyError extends Error {
  constructor(
    readonly reason:
      | "file tools are limited to the authorized workspace"
      | "file mutations cannot target a host-protected path"
      | "file access is denied by the active permission profile"
      | "file access is not granted by the active permission profile",
  ) {
    super(reason);
    this.name = "FilePolicyError";
  }
}

export function pathContains(parent: string, child: string): boolean {
  const root = resolve(parent);
  const target = resolve(child);
  const candidate = relative(root, target);
  return (
    candidate === "" ||
    (candidate !== ".." &&
      !candidate.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(candidate))
  );
}

export type FileAccessDecision = "allowed" | "missing" | "denied";

export function permissionProfileFileAccess(profile: PermissionProfile, access: FileAccess): FileAccessDecision {
  if (profile.type === "disabled") return "allowed";
  if (profile.type === "external") return "missing";
  if (profile.fileSystem.type === "unrestricted") return "allowed";
  const applicable = profile.fileSystem.entries.filter((entry) => pathContains(entry.path, access.path));
  const priority = { read: 0, write: 1, deny: 2 } as const;
  const mostSpecific = applicable.sort(
    (left, right) => right.path.length - left.path.length || priority[right.access] - priority[left.access],
  )[0];
  if (!mostSpecific) return "missing";
  if (mostSpecific.access === "deny") return "denied";
  if (mostSpecific.access === "write" || (mostSpecific.access === "read" && access.access === "read")) {
    return "allowed";
  }
  return "missing";
}

export function permissionProfileForFileAccesses(
  profile: PermissionProfile,
  accesses: FileAccess[],
): PermissionProfile {
  const missing = accesses.filter((access) => permissionProfileFileAccess(profile, access) === "missing");
  if (missing.length === 0) return profile;
  if (profile.type !== "managed") {
    throw new FilePolicyError("file access is not granted by the active permission profile");
  }
  const expanded = applyAdditionalPermissions(profile, {
    file_system: {
      read: missing.filter((item) => item.access === "read").map((item) => item.path),
      write: missing.filter((item) => item.access === "write").map((item) => item.path),
    },
  });
  if (accesses.some((access) => permissionProfileFileAccess(expanded, access) !== "allowed")) {
    throw new FilePolicyError("file access is not granted by the active permission profile");
  }
  return expanded;
}

function resolveFilePath(policy: FileSystemPolicy, path: string, readOnly = false): string {
  if (path.includes("\0")) throw new FilePolicyError("file tools are limited to the authorized workspace");
  const target = resolve(isAbsolute(path) ? path : resolve(policy.workingDirectory, path));
  if (
    !pathContains(policy.workspaceRoot, target) &&
    !(readOnly && policy.additionalReadRoots?.some((root) => pathContains(root, target)))
  ) {
    throw new FilePolicyError("file tools are limited to the authorized workspace");
  }
  return target;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("file tool input must be an object");
  return input as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || !value) throw new Error(`file tool input requires ${name}`);
  return value;
}

export function fileToolAccesses(toolName: FileToolName, input: unknown, policy: FileSystemPolicy): FileAccess[] {
  let resolved: FileAccess[];
  if (toolName === "apply_patch") {
    if (typeof input !== "string") throw new Error("apply_patch requires a freeform patch");
    resolved = parseApplyPatch(input).paths.map((path) => ({ path: resolveFilePath(policy, path), access: "write" }));
  } else {
    resolved = [
      {
        path: resolveFilePath(policy, stringField(objectInput(input), "path"), toolName === "read_file"),
        access: toolName === "read_file" ? "read" : "write",
      },
    ];
  }
  for (const access of resolved) {
    if (access.access === "write" && policy.immutableWriteRoots?.some((root) => pathContains(root, access.path))) {
      throw new FilePolicyError("file mutations cannot target a host-protected path");
    }
  }
  return resolved;
}

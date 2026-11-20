import { isAbsolute, relative, resolve } from "node:path";

import { parseApplyPatch } from "../tools/apply-patch.js";
import { applyAdditionalPermissions, type PermissionProfile } from "./permissions.js";
import type { ProcessIdentity } from "./process-manager.js";

export type FileToolName = "read_file" | "apply_patch" | "write_file";
export type FileAccess = { path: string; access: "read" | "write" };

export interface FileSystemPolicy {
  workspaceRoot: string;
  workingDirectory: string;
  immutableWriteRoots?: string[];
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

function pathContains(parent: string, child: string): boolean {
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

function resolveFilePath(policy: FileSystemPolicy, path: string): string {
  if (path.includes("\0")) throw new FilePolicyError("file tools are limited to the authorized workspace");
  const target = resolve(isAbsolute(path) ? path : resolve(policy.workingDirectory, path));
  if (!pathContains(policy.workspaceRoot, target)) {
    throw new FilePolicyError("file tools are limited to the authorized workspace");
  }
  return target;
}

function recordAccess(target: Map<string, FileAccess>, path: string, access: FileAccess["access"]): void {
  const existing = target.get(path);
  if (!existing || (existing.access === "read" && access === "write")) target.set(path, { path, access });
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
  const value = objectInput(input);
  const accesses = new Map<string, FileAccess>();
  if (toolName === "read_file") {
    recordAccess(accesses, resolveFilePath(policy, stringField(value, "path")), "read");
  } else if (toolName === "write_file") {
    recordAccess(accesses, resolveFilePath(policy, stringField(value, "path")), "write");
  } else {
    const patch = parseApplyPatch(stringField(value, "patch"));
    for (const action of patch.actions) {
      recordAccess(accesses, resolveFilePath(policy, action.path), "write");
      if (action.type === "update" && action.moveTo) {
        recordAccess(accesses, resolveFilePath(policy, action.moveTo), "write");
      }
    }
  }
  const resolved = [...accesses.values()];
  for (const access of resolved) {
    if (access.access === "write" && policy.immutableWriteRoots?.some((root) => pathContains(root, access.path))) {
      throw new FilePolicyError("file mutations cannot target a host-protected path");
    }
  }
  return resolved;
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
  const expanded = applyAdditionalPermissions(profile, { fileSystem: missing });
  if (accesses.some((access) => permissionProfileFileAccess(expanded, access) !== "allowed")) {
    throw new FilePolicyError("file access is not granted by the active permission profile");
  }
  return expanded;
}

import { isAbsolute, posix } from "node:path";

export const BUILT_IN_PERMISSION_PROFILE_READ_ONLY = ":read-only" as const;
export const BUILT_IN_PERMISSION_PROFILE_WORKSPACE = ":workspace" as const;
export const BUILT_IN_PERMISSION_PROFILE_DANGER_FULL_ACCESS = ":danger-full-access" as const;

export type BuiltInPermissionProfileId =
  | typeof BUILT_IN_PERMISSION_PROFILE_READ_ONLY
  | typeof BUILT_IN_PERMISSION_PROFILE_WORKSPACE
  | typeof BUILT_IN_PERMISSION_PROFILE_DANGER_FULL_ACCESS;
export type PermissionProfileId = BuiltInPermissionProfileId | (string & {});
export type ApprovalPolicy = "never" | "on-request" | "unless-trusted" | "granular";
export type SandboxPermissions = "use_default" | "with_additional_permissions" | "require_escalated";

export interface FileSystemPermissionEntry {
  path: string;
  access: "read" | "write" | "deny";
}

export type NetworkSandboxPolicy = { type: "restricted"; allowedHosts: string[] } | { type: "enabled" };

export type PermissionProfile =
  | {
      type: "managed";
      fileSystem: { type: "restricted"; entries: FileSystemPermissionEntry[] } | { type: "unrestricted" };
      network: NetworkSandboxPolicy;
    }
  | { type: "disabled" }
  | { type: "external"; network: NetworkSandboxPolicy };

export interface AdditionalPermissionProfile {
  file_system?: { read?: string[]; write?: string[] };
  network?: { enabled?: boolean };
}

export interface ActivePermissionProfile {
  id: PermissionProfileId;
  profile: PermissionProfile;
}

function normalizedAbsolutePath(path: string): string {
  if (!isAbsolute(path)) throw new Error(`permission path must be absolute: ${path}`);
  const normalized = posix.normalize(path);
  if (normalized.includes("\0")) throw new Error("permission path contains a null byte");
  return normalized;
}

function normalizedHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.$/u, "");
  if (!normalized || normalized.includes(":") || !/^[a-z0-9.-]+$/u.test(normalized)) {
    throw new Error(`invalid network permission host: ${host}`);
  }
  return normalized;
}

function cloneNetwork(policy: NetworkSandboxPolicy): NetworkSandboxPolicy {
  return policy.type === "enabled"
    ? { type: "enabled" }
    : { type: "restricted", allowedHosts: [...new Set(policy.allowedHosts.map(normalizedHost))].sort() };
}

const FILE_SYSTEM_ACCESS_PRIORITY = { read: 0, write: 1, deny: 2 } as const;

function cloneFileSystemEntries(entries: readonly FileSystemPermissionEntry[]): FileSystemPermissionEntry[] {
  const byPath = new Map<string, FileSystemPermissionEntry>();
  for (const source of entries) {
    const entry = { ...source, path: normalizedAbsolutePath(source.path) };
    const existing = byPath.get(entry.path);
    if (!existing || FILE_SYSTEM_ACCESS_PRIORITY[entry.access] > FILE_SYSTEM_ACCESS_PRIORITY[existing.access]) {
      byPath.set(entry.path, entry);
    }
  }
  return [...byPath.values()].sort((left, right) => {
    const depth = left.path.split("/").filter(Boolean).length - right.path.split("/").filter(Boolean).length;
    return depth || FILE_SYSTEM_ACCESS_PRIORITY[left.access] - FILE_SYSTEM_ACCESS_PRIORITY[right.access];
  });
}

export function clonePermissionProfile(profile: PermissionProfile): PermissionProfile {
  if (profile.type === "disabled") return { type: "disabled" };
  if (profile.type === "external") return { type: "external", network: cloneNetwork(profile.network) };
  return {
    type: "managed",
    fileSystem:
      profile.fileSystem.type === "unrestricted"
        ? { type: "unrestricted" }
        : { type: "restricted", entries: cloneFileSystemEntries(profile.fileSystem.entries) },
    network: cloneNetwork(profile.network),
  };
}

export function compilePermissionProfile(
  id: PermissionProfileId,
  context: { workspaceRoot: string; profiles?: Record<string, PermissionProfile> },
): ActivePermissionProfile {
  const workspaceRoot = normalizedAbsolutePath(context.workspaceRoot);
  switch (id) {
    case BUILT_IN_PERMISSION_PROFILE_READ_ONLY:
      return {
        id,
        profile: {
          type: "managed",
          fileSystem: { type: "restricted", entries: [{ path: "/", access: "read" }] },
          network: { type: "restricted", allowedHosts: [] },
        },
      };
    case BUILT_IN_PERMISSION_PROFILE_WORKSPACE:
      return {
        id,
        profile: {
          type: "managed",
          fileSystem: {
            type: "restricted",
            entries: [
              { path: "/", access: "read" },
              { path: workspaceRoot, access: "write" },
            ],
          },
          network: { type: "restricted", allowedHosts: [] },
        },
      };
    case BUILT_IN_PERMISSION_PROFILE_DANGER_FULL_ACCESS:
      return { id, profile: { type: "disabled" } };
    default: {
      const profile = context.profiles?.[id];
      if (!profile) throw new Error(`unknown permission profile: ${id}`);
      return { id, profile: clonePermissionProfile(profile) };
    }
  }
}

export function permissionProfileHasDeniedReads(profile: PermissionProfile): boolean {
  return (
    profile.type === "managed" &&
    profile.fileSystem.type === "restricted" &&
    profile.fileSystem.entries.some((entry) => entry.access === "deny")
  );
}

export function permissionProfileForEscalatedCommand(profile: PermissionProfile): PermissionProfile {
  if (profile.type === "disabled") return { type: "disabled" };
  if (profile.type === "external") {
    throw new Error("external sandbox enforcement cannot be bypassed by a command approval");
  }
  if (!permissionProfileHasDeniedReads(profile)) return { type: "disabled" };
  const entries =
    profile.fileSystem.type === "restricted"
      ? [
          { path: "/", access: "write" as const },
          ...profile.fileSystem.entries.filter((entry) => entry.path !== "/" && entry.access !== "write"),
        ]
      : [{ path: "/", access: "write" as const }];
  return clonePermissionProfile({
    type: "managed",
    fileSystem: { type: "restricted", entries },
    network: { type: "enabled" },
  });
}

function pathContains(parent: string, child: string): boolean {
  return parent === "/" || child === parent || child.startsWith(`${parent}/`);
}

export function applyAdditionalPermissions(
  base: PermissionProfile,
  additional: AdditionalPermissionProfile | undefined,
): PermissionProfile {
  const result = clonePermissionProfile(base);
  if (!additional || result.type === "disabled") return result;

  const grants: FileSystemPermissionEntry[] = [
    ...(additional.file_system?.read ?? []).map((path) => ({ path, access: "read" as const })),
    ...(additional.file_system?.write ?? []).map((path) => ({ path, access: "write" as const })),
  ];
  if (grants.length) {
    if (result.type !== "managed") {
      throw new Error("additional filesystem permissions require managed enforcement");
    }
    if (result.fileSystem.type === "restricted") {
      const denied = result.fileSystem.entries.filter((entry) => entry.access === "deny");
      for (const candidate of grants) {
        const entry = { ...candidate, path: normalizedAbsolutePath(candidate.path) };
        if (denied.some((item) => pathContains(item.path, entry.path))) continue;
        const existing = result.fileSystem.entries.find((item) => item.path === entry.path);
        if (!existing) result.fileSystem.entries.push(entry);
        else if (existing.access !== "deny" && existing.access === "read" && entry.access === "write") {
          existing.access = "write";
        }
      }
    }
  }

  if (additional.network?.enabled) result.network = { type: "enabled" };
  return clonePermissionProfile(result);
}

export function permissionProfileSummary(profile: PermissionProfile): "managed" | "disabled" | "external" {
  return profile.type;
}

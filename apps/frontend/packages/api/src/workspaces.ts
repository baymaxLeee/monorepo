/**
 * IAM workspace / membership / platform-role client.
 *
 * The IAM service keeps a hand-written typed client (it is not part of the
 * OpenAPI codegen). Onboarding uses the public directory + self-service apply;
 * management calls are gated server-side (super_admin / active workspace_admin) — the
 * UI only hides what the caller can't do; the API is the real boundary.
 */
import { type ApiRequestConfig, request } from "./http";

type RequestOptions = Pick<ApiRequestConfig, "skipErrorNotify">;

export type WorkspaceSummary = { id: string; tenantId: string; name: string };

export type WorkspaceAdminView = {
  tenantId: string;
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  systemManaged: boolean;
  joinPolicy: "open" | "approval";
  memberCount: number;
  createdAt: string;
};

export type WorkspaceMemberView = {
  userId: string;
  account: string;
  displayName: string;
  email: string;
  role: "workspace_admin" | "member";
  status: "pending" | "active" | "rejected";
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
};

export type PlatformRole = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
};

const base = "/api/iam-server";

// --- Public directory + self-service ------------------------------------

/** Public, applyable workspace list ({id,name} only). No auth required. */
export async function fetchPublicWorkspaces(options?: RequestOptions): Promise<WorkspaceSummary[]> {
  return request<WorkspaceSummary[]>({
    url: `${base}/workspaces`,
    method: "GET",
    ...options,
  });
}

/** (Re)apply to join an workspace from none/rejected → pending. */
export async function applyToWorkspace(workspaceId: string): Promise<void> {
  await request<void>({
    url: `${base}/me/memberships/${encodeURIComponent(workspaceId)}/apply`,
    method: "POST",
  });
}

// --- super_admin: workspace management -------------------------------

export type CreateWorkspaceInput = {
  tenantId: string;
  name: string;
  slug: string;
  ownerUserId?: string;
  ownerAccount?: string;
  ownerEmail?: string;
  ownerPassword?: string;
  ownerDisplayName?: string;
};

export async function listWorkspacesForAdmin(options?: RequestOptions): Promise<WorkspaceAdminView[]> {
  return request<WorkspaceAdminView[]>({
    url: `${base}/workspaces/admin`,
    method: "GET",
    ...options,
  });
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceAdminView> {
  return request<WorkspaceAdminView>({
    url: `${base}/workspaces`,
    method: "POST",
    data: input,
  });
}

export type CreateWorkspaceAdminInput = {
  account: string;
  email: string;
  password: string;
  displayName?: string;
};

export async function createWorkspaceAdmin(
  workspaceId: string,
  input: CreateWorkspaceAdminInput,
): Promise<WorkspaceMemberView> {
  return request<WorkspaceMemberView>({
    url: `${base}/workspaces/${encodeURIComponent(workspaceId)}/admins`,
    method: "POST",
    data: input,
  });
}

export async function transferWorkspaceOwner(workspaceId: string, newOwnerUserId: string): Promise<void> {
  await request<void>({
    url: `${base}/workspaces/${encodeURIComponent(workspaceId)}/owner`,
    method: "PUT",
    data: { newOwnerUserId },
  });
}

// --- workspace_admin (or super_admin): membership review ----------------------

export async function listWorkspaceMembers(
  workspaceId: string,
  status?: "pending" | "active" | "rejected",
  options?: RequestOptions,
): Promise<WorkspaceMemberView[]> {
  return request<WorkspaceMemberView[]>({
    url: `${base}/workspaces/${encodeURIComponent(workspaceId)}/members`,
    method: "GET",
    params: status ? { status } : undefined,
    ...options,
  });
}

export async function approveMember(workspaceId: string, userId: string): Promise<void> {
  await request<void>({
    url: `${base}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}/approve`,
    method: "POST",
  });
}

export async function rejectMember(workspaceId: string, userId: string, reason?: string): Promise<void> {
  await request<void>({
    url: `${base}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}/reject`,
    method: "POST",
    data: { reason: reason ?? "" },
  });
}

export async function setMemberRole(
  workspaceId: string,
  userId: string,
  role: "workspace_admin" | "member",
): Promise<void> {
  await request<void>({
    url: `${base}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}/role`,
    method: "PUT",
    data: { role },
  });
}

// --- super_admin: platform roles ----------------------------------------

export async function listPlatformRoles(): Promise<PlatformRole[]> {
  return request<PlatformRole[]>({ url: `${base}/roles`, method: "GET" });
}

export async function listUserPlatformRoles(userId: string): Promise<PlatformRole[]> {
  return request<PlatformRole[]>({
    url: `${base}/users/${encodeURIComponent(userId)}/roles`,
    method: "GET",
  });
}

export async function assignUserRole(userId: string, roleId: string): Promise<void> {
  await request<void>({
    url: `${base}/users/${encodeURIComponent(userId)}/roles`,
    method: "POST",
    data: { roleId },
  });
}

export async function removeUserRole(userId: string, roleId: string): Promise<void> {
  await request<void>({
    url: `${base}/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
    method: "DELETE",
  });
}

export type Tenant = { id: string; name: string; slug: string };
export function listTenants(): Promise<Tenant[]> {
  return request<Tenant[]>({ url: `${base}/tenants`, method: "GET" });
}
export function createTenant(input: { name: string; slug: string }): Promise<Tenant> {
  return request<Tenant>({ url: `${base}/tenants`, method: "POST", data: input });
}

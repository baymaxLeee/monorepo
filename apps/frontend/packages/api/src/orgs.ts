/**
 * IAM organization / membership / platform-role client.
 *
 * The IAM service keeps a hand-written typed client (it is not part of the
 * OpenAPI codegen). Onboarding uses the public directory + self-service apply;
 * management calls are gated server-side (super_admin / active org_admin) — the
 * UI only hides what the caller can't do; the API is the real boundary.
 */
import { type ApiRequestConfig, request } from "./http";

type RequestOptions = Pick<ApiRequestConfig, "skipErrorNotify">;

export type OrgSummary = { id: string; name: string };

export type OrgAdminView = {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  systemManaged: boolean;
  joinPolicy: "open" | "approval";
  memberCount: number;
  createdAt: string;
};

export type OrgMemberView = {
  userId: string;
  account: string;
  displayName: string;
  email: string;
  role: "org_admin" | "member";
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

/** Public, applyable org list ({id,name} only). No auth required. */
export async function fetchPublicOrgs(options?: RequestOptions): Promise<OrgSummary[]> {
  return request<OrgSummary[]>({
    url: `${base}/orgs`,
    method: "GET",
    ...options,
  });
}

/** (Re)apply to join an org from none/rejected → pending. */
export async function applyToOrg(orgId: string): Promise<void> {
  await request<void>({
    url: `${base}/me/memberships/${encodeURIComponent(orgId)}/apply`,
    method: "POST",
  });
}

// --- super_admin: organization management -------------------------------

export type CreateOrgInput = {
  name: string;
  slug: string;
  ownerUserId?: string;
  ownerAccount?: string;
  ownerEmail?: string;
  ownerPassword?: string;
  ownerDisplayName?: string;
};

export async function listOrgsForAdmin(options?: RequestOptions): Promise<OrgAdminView[]> {
  return request<OrgAdminView[]>({
    url: `${base}/orgs/admin`,
    method: "GET",
    ...options,
  });
}

export async function createOrg(input: CreateOrgInput): Promise<OrgAdminView> {
  return request<OrgAdminView>({
    url: `${base}/orgs`,
    method: "POST",
    data: input,
  });
}

export type CreateOrgAdminInput = {
  account: string;
  email: string;
  password: string;
  displayName?: string;
};

export async function createOrgAdmin(orgId: string, input: CreateOrgAdminInput): Promise<OrgMemberView> {
  return request<OrgMemberView>({
    url: `${base}/orgs/${encodeURIComponent(orgId)}/admins`,
    method: "POST",
    data: input,
  });
}

export async function transferOrgOwner(orgId: string, newOwnerUserId: string): Promise<void> {
  await request<void>({
    url: `${base}/orgs/${encodeURIComponent(orgId)}/owner`,
    method: "PUT",
    data: { newOwnerUserId },
  });
}

// --- org_admin (or super_admin): membership review ----------------------

export async function listOrgMembers(
  orgId: string,
  status?: "pending" | "active" | "rejected",
  options?: RequestOptions,
): Promise<OrgMemberView[]> {
  return request<OrgMemberView[]>({
    url: `${base}/orgs/${encodeURIComponent(orgId)}/members`,
    method: "GET",
    params: status ? { status } : undefined,
    ...options,
  });
}

export async function approveMember(orgId: string, userId: string): Promise<void> {
  await request<void>({
    url: `${base}/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/approve`,
    method: "POST",
  });
}

export async function rejectMember(orgId: string, userId: string, reason?: string): Promise<void> {
  await request<void>({
    url: `${base}/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/reject`,
    method: "POST",
    data: { reason: reason ?? "" },
  });
}

export async function setMemberRole(orgId: string, userId: string, role: "org_admin" | "member"): Promise<void> {
  await request<void>({
    url: `${base}/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/role`,
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

import { usePlatformStore } from "@repo/runtime";
import { useShallow } from "zustand/react/shallow";

/**
 * Admin-side view of the caller's authority. This is UI gating only — every
 * management API is enforced server-side (super_admin / active org_admin);
 * hiding a control here is a convenience, never the security boundary.
 */
export type AdminIdentity = {
  userId: string | null;
  isSuperAdmin: boolean;
  isOrgAdmin: boolean;
  activeOrgId: string | null;
  activeOrgName: string | null;
  /**
   * May READ a member roster: a super_admin (governance/oversight over any org)
   * or an org_admin of the active org. Reading the roster is not access to org
   * business data.
   */
  canViewMembers: boolean;
  /**
   * May WRITE member state (approve/reject/set role). Strictly an active
   * org_admin of the *active* org — a super_admin is NOT auto-granted this over
   * every tenant (GitHub enterprise-owner model). To manage a specific org, a
   * super_admin must be an active org_admin of it.
   */
  canManageMembers: boolean;
};

export function useAdminIdentity(): AdminIdentity {
  const user = usePlatformStore(useShallow((s) => s.user));
  const roles = user?.roles;
  const isSuperAdmin = Array.isArray(roles) && roles.includes("super_admin");
  const isOrgAdmin = user?.activeOrg?.role === "org_admin";
  return {
    userId: user?.id ?? null,
    isSuperAdmin,
    isOrgAdmin,
    activeOrgId: user?.activeOrg?.orgId ?? null,
    activeOrgName: user?.activeOrg?.orgName ?? null,
    canViewMembers: isSuperAdmin || isOrgAdmin,
    canManageMembers: isOrgAdmin,
  };
}

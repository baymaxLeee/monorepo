import { usePlatformStore } from "@repo/runtime";
import { useShallow } from "zustand/react/shallow";

/**
 * Admin-side view of the caller's authority. This is UI gating only — every
 * management API is enforced server-side (super_admin / active workspace_admin);
 * hiding a control here is a convenience, never the security boundary.
 */
export type AdminIdentity = {
  userId: string | null;
  isSuperAdmin: boolean;
  isWorkspaceAdmin: boolean;
  activeWorkspaceId: string | null;
  activeWorkspaceName: string | null;
  /**
   * May READ a member roster: a super_admin (governance/oversight over any workspace)
   * or an workspace_admin of the active workspace. Reading the roster is not access to workspace
   * business data.
   */
  canViewMembers: boolean;
  /**
   * May WRITE member state (approve/reject/set role). Strictly an active
   * workspace_admin of the *active* workspace — a super_admin is NOT auto-granted this over
   * every tenant (GitHub enterprise-owner model). To manage a specific workspace, a
   * super_admin must be an active workspace_admin of it.
   */
  canManageMembers: boolean;
};

export function useAdminIdentity(): AdminIdentity {
  const user = usePlatformStore(useShallow((s) => s.user));
  const roles = user?.roles;
  const isSuperAdmin = Array.isArray(roles) && roles.includes("super_admin");
  const isWorkspaceAdmin = user?.activeWorkspace?.role === "workspace_admin";
  return {
    userId: user?.id ?? null,
    isSuperAdmin,
    isWorkspaceAdmin,
    activeWorkspaceId: user?.activeWorkspace?.workspaceId ?? null,
    activeWorkspaceName: user?.activeWorkspace?.workspaceName ?? null,
    canViewMembers: isSuperAdmin || isWorkspaceAdmin,
    canManageMembers: isWorkspaceAdmin,
  };
}

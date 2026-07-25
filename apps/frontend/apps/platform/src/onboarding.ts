import type { PlatformMembership, PlatformUser } from "runtime";

export const SUPER_ADMIN = "super_admin";

export function isSuperAdmin(user: Pick<PlatformUser, "roles">): boolean {
  return Array.isArray(user.roles) && user.roles.includes(SUPER_ADMIN);
}

export function activeMemberships(user: Pick<PlatformUser, "memberships">): PlatformMembership[] {
  return Array.isArray(user.memberships) ? user.memberships.filter((m) => m.status === "active") : [];
}

export function canEnterPlatform(user: PlatformUser): boolean {
  return !!user.activeOrg || isSuperAdmin(user);
}

/**
 * Where a signed-in user belongs, given their org binding + memberships:
 * - already bound to an org, or a super_admin (management plane) → the shell
 * - has active memberships but no bound org → pick one
 * - otherwise (only pending/rejected) → the waiting room
 *
 * The platform shell + backend are the real authority; this only decides the
 * initial landing so users never stare at an empty, org-scoped shell.
 */
export function landingPath(user: PlatformUser): string {
  if (canEnterPlatform(user)) {
    return "/platform/chat";
  }
  if (activeMemberships(user).length > 0) {
    return "/select-org";
  }
  return "/pending";
}

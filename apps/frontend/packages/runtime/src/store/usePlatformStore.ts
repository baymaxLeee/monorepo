import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** One org membership from the user's own point of view. Mirrors the api
 * package `Membership` (kept local so runtime stays leaf, not api-dependent). */
export type PlatformMembership = {
  orgId: string;
  orgName: string;
  role: "org_admin" | "member";
  status: "pending" | "active" | "rejected";
};

export type PlatformUser = {
  id: string;
  account: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  locale: string;
  timezone: string;
  theme: "system" | "light" | "dark" | string;
  marketingOptIn: boolean;
  emailVerified: boolean;
  /** Platform roles (e.g. "super_admin"); orthogonal to org roles. */
  roles: string[];
  /** The single org this session is bound to, or null when unscoped. */
  activeOrg: PlatformMembership | null;
  /** Every org the user belongs to, in any status. */
  memberships: PlatformMembership[];
};

export type PlatformState = {
  user: PlatformUser | null;
  sidebarCollapsed: boolean;
  setUser: (user: PlatformUser | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  resetPlatformState: () => void;
};

type PersistedPlatformState = Pick<PlatformState, "sidebarCollapsed" | "user">;

const initialState: PersistedPlatformState = {
  user: null,
  sidebarCollapsed: false,
};

/**
 * A persisted user is only usable if it carries the two-dimensional identity
 * arrays (`roles` + `memberships`). A partial/legacy blob — e.g. one cached
 * across an identity-schema change — must be dropped rather than fed to routing
 * helpers that call `.includes`/`.filter`, which would throw on `undefined`.
 */
function isValidUser(user: unknown): user is PlatformUser {
  return (
    !!user &&
    typeof user === "object" &&
    Array.isArray((user as { roles?: unknown }).roles) &&
    Array.isArray((user as { memberships?: unknown }).memberships)
  );
}

export const usePlatformStore = create<PlatformState>()(
  persist(
    (set) => ({
      ...initialState,
      setUser: (user) => set({ user }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      resetPlatformState: () => set(initialState),
    }),
    {
      name: "platform.store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedPlatformState => ({
        user: state.user,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
      // v3: identity switched to two-dimensional roles + activeOrg + memberships.
      // Old cached `user` blobs (flat type/orgId) are structurally incompatible;
      // drop them so the app re-bootstraps a fresh session shape.
      version: 3,
      migrate: (persisted, from) => {
        const state = persisted as Partial<PersistedPlatformState> | undefined;
        if (from < 3) {
          return {
            sidebarCollapsed: state?.sidebarCollapsed ?? false,
            user: null,
          };
        }
        return state as PersistedPlatformState;
      },
      merge: (persisted, current) => {
        const state = persisted as Partial<PersistedPlatformState> | undefined;
        return {
          ...current,
          sidebarCollapsed: state?.sidebarCollapsed ?? false,
          user: isValidUser(state?.user) ? state.user : null,
        };
      },
    },
  ),
);

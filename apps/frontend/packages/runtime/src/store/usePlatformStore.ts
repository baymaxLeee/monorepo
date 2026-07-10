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

type PersistedPlatformState = Pick<PlatformState, "sidebarCollapsed">;

const initialState: Pick<PlatformState, "user" | "sidebarCollapsed"> = {
  user: null,
  sidebarCollapsed: false,
};

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
        sidebarCollapsed: state.sidebarCollapsed,
      }),
      version: 4,
      migrate: (persisted) => {
        const state = persisted as Partial<PersistedPlatformState> | undefined;
        return { sidebarCollapsed: state?.sidebarCollapsed ?? false };
      },
      merge: (persisted, current) => {
        const state = persisted as Partial<PersistedPlatformState> | undefined;
        return {
          ...current,
          sidebarCollapsed: state?.sidebarCollapsed ?? false,
        };
      },
    },
  ),
);

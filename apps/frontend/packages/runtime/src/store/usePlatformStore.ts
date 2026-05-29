import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Coarse identity class used to gate which apps/products are visible. */
export type PlatformUserType = "admin" | "normal";

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
  /** Absent in pre-upgrade cached sessions → callers treat as "normal". */
  type?: PlatformUserType;
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
      version: 2,
    },
  ),
);

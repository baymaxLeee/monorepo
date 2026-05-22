import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type PlatformUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  locale: string;
  timezone: string;
  theme: "system" | "light" | "dark" | string;
  marketingOptIn: boolean;
  emailVerified: boolean;
};

export type PlatformSubMenuItem = {
  title: string;
  href: string;
};

export type PlatformMenuItem = {
  id: string;
  title: string;
  basePath: string;
  subNav?: PlatformSubMenuItem[];
};

export type PlatformState = {
  user: PlatformUser | null;
  sidebarCollapsed: boolean;
  menus: PlatformMenuItem[];
  activeMenuId: string | null;
  setUser: (user: PlatformUser | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMenus: (menus: PlatformMenuItem[]) => void;
  setActiveMenuId: (id: string | null) => void;
  resetPlatformState: () => void;
};

type PersistedPlatformState = Pick<
  PlatformState,
  "activeMenuId" | "menus" | "sidebarCollapsed" | "user"
>;

const initialState: PersistedPlatformState = {
  user: null,
  sidebarCollapsed: false,
  menus: [],
  activeMenuId: null,
};

export const usePlatformStore = create<PlatformState>()(
  persist(
    (set) => ({
      ...initialState,
      setUser: (user) => set({ user }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setMenus: (menus) => set({ menus }),
      setActiveMenuId: (activeMenuId) => set({ activeMenuId }),
      resetPlatformState: () => set(initialState),
    }),
    {
      name: "platform.store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedPlatformState => ({
        user: state.user,
        sidebarCollapsed: state.sidebarCollapsed,
        menus: state.menus,
        activeMenuId: state.activeMenuId,
      }),
    },
  ),
);

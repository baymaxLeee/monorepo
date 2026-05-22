import { create } from "zustand";

export type AdminState = {
  createDialogOpen: boolean;
  selectedBotId: string | null;
  setCreateDialogOpen: (open: boolean) => void;
  setSelectedBotId: (id: string | null) => void;
  resetAdminState: () => void;
};

const initialState = {
  createDialogOpen: false,
  selectedBotId: null,
};

export const useAdminStore = create<AdminState>((set) => ({
  ...initialState,
  setCreateDialogOpen: (createDialogOpen) => set({ createDialogOpen }),
  setSelectedBotId: (selectedBotId) => set({ selectedBotId }),
  resetAdminState: () => set(initialState),
}));

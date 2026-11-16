import { create } from "zustand";

type LocalWorkspaceState = {
  open: boolean;
  threadId: string | null;
  path: string | null;
  dirty: boolean;
  closeBlocked: boolean;
  openWorkspace: (threadId: string, path?: string | null) => void;
  requestClose: () => void;
  setDirty: (dirty: boolean) => void;
  reset: () => void;
};

const CLOSED = {
  open: false,
  threadId: null,
  path: null,
  dirty: false,
  closeBlocked: false,
} as const;

export const useLocalWorkspaceStore = create<LocalWorkspaceState>((set) => ({
  ...CLOSED,
  openWorkspace: (threadId, path = null) =>
    set((state) => {
      const sameThread = state.threadId === threadId;
      if (sameThread && state.dirty && path !== state.path) {
        return { open: true, closeBlocked: true };
      }
      return {
        open: true,
        threadId,
        path,
        dirty: sameThread ? state.dirty : false,
        closeBlocked: sameThread ? state.closeBlocked : false,
      };
    }),
  requestClose: () => set((state) => (state.dirty ? { closeBlocked: true } : { ...CLOSED })),
  setDirty: (dirty) => set(dirty ? { dirty: true } : { dirty: false, closeBlocked: false }),
  reset: () => set({ ...CLOSED }),
}));

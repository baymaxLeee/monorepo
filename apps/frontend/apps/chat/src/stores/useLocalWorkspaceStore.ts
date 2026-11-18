import { allowArtifactNavigation } from "@repo/ai-elements/conversation/store/artifactNavigationGuard";
import { create } from "zustand";

type LocalWorkspaceState = {
  open: boolean;
  threadId: string | null;
  path: string | null;
  openWorkspace: (threadId: string, path?: string | null) => void;
  requestClose: () => void;
  reset: () => void;
};

const CLOSED = {
  open: false,
  threadId: null,
  path: null,
} as const;

export const useLocalWorkspaceStore = create<LocalWorkspaceState>((set) => ({
  ...CLOSED,
  openWorkspace: (threadId, path = null) =>
    void allowArtifactNavigation().then((allowed) => {
      if (allowed) set({ open: true, threadId, path });
    }),
  requestClose: () =>
    void allowArtifactNavigation().then((allowed) => {
      if (allowed) set({ ...CLOSED });
    }),
  reset: () => set({ ...CLOSED }),
}));

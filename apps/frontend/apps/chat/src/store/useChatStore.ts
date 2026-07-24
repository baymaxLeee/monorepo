import { type Bot, fetchBots } from "api";
import { getErrorMessage } from "shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ArtifactPreviewState = {
  open: boolean;
  conversationId: string | null;
  documentId: string | null;
  path: string | null;
  // Bumped on every open so re-opening the same in-place-edited artifact
  // (same id) still forces the panel to refetch the latest revision.
  token: number;
};

export type ImagePreviewRef = { documentId: string; filename?: string };

export type ImagePreviewState = {
  open: boolean;
  conversationId: string | null;
  images: ImagePreviewRef[];
  index: number;
};

export type VideoProductionWorkspaceState = {
  open: boolean;
  conversationId: string | null;
  productionId: string | null;
};

export type ChatUIState = {
  sendingConversationId: string | null;
  setSendingConversationId: (id: string | null) => void;
  agents: Bot[] | null;
  agentsError: string | null;
  isLoadingAgents: boolean;
  loadAgents: () => Promise<void>;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  memoryPanelOpen: boolean;
  setMemoryPanelOpen: (open: boolean) => void;
  tracePanelOpen: boolean;
  traceConversationId: string | null;
  traceRunId: string | null;
  traceRefreshKey: number;
  setTraceRun: (conversationId: string, runId: string) => void;
  clearTraceRun: () => void;
  openTracePanel: (conversationId: string) => void;
  setTracePanelOpen: (open: boolean) => void;
  bumpTraceRefresh: () => void;
  artifactPreview: ArtifactPreviewState;
  openArtifactPreview: (conversationId: string, documentId: string) => void;
  openFilePreview: (conversationId: string, path: string) => void;
  closeArtifactPreview: () => void;
  videoProductionWorkspace: VideoProductionWorkspaceState;
  openVideoProductionWorkspace: (
    conversationId: string,
    productionId: string,
  ) => void;
  closeVideoProductionWorkspace: () => void;
  imagePreview: ImagePreviewState;
  openImagePreview: (
    conversationId: string,
    images: ImagePreviewRef[],
    index: number,
  ) => void;
  closeImagePreview: () => void;
  setImagePreviewIndex: (index: number) => void;
  conversationTitleUpdate: { id: string; title: string; seq: number } | null;
  applyConversationTitle: (id: string, title: string) => void;
};

type Persisted = Pick<ChatUIState, "selectedAgentId">;

const CLOSED_ARTIFACT_PREVIEW: ArtifactPreviewState = {
  open: false,
  conversationId: null,
  documentId: null,
  path: null,
  token: 0,
};

const CLOSED_IMAGE_PREVIEW: ImagePreviewState = {
  open: false,
  conversationId: null,
  images: [],
  index: 0,
};

const CLOSED_VIDEO_PRODUCTION_WORKSPACE: VideoProductionWorkspaceState = {
  open: false,
  conversationId: null,
  productionId: null,
};

export const useChatStore = create<ChatUIState>()(
  persist(
    (set, get) => ({
      sendingConversationId: null,
      setSendingConversationId: (sendingConversationId) =>
        set({ sendingConversationId }),

      agents: null,
      agentsError: null,
      isLoadingAgents: false,
      async loadAgents() {
        if (get().isLoadingAgents) return;
        set({ isLoadingAgents: true, agentsError: null });
        try {
          const list = await fetchBots({ skipErrorNotify: true });
          const selected = get().selectedAgentId;
          const stillExists = selected
            ? list.some((a) => a.id === selected)
            : false;
          set({
            agents: list,
            selectedAgentId: stillExists ? selected : (list[0]?.id ?? null),
          });
        } catch (error) {
          set({ agents: [], agentsError: getErrorMessage(error) });
        } finally {
          set({ isLoadingAgents: false });
        }
      },

      selectedAgentId: null,
      setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),

      memoryPanelOpen: false,
      setMemoryPanelOpen: (memoryPanelOpen) =>
        set({
          memoryPanelOpen,
          ...(memoryPanelOpen
            ? {
                tracePanelOpen: false,
                artifactPreview: CLOSED_ARTIFACT_PREVIEW,
                videoProductionWorkspace: CLOSED_VIDEO_PRODUCTION_WORKSPACE,
              }
            : {}),
        }),

      tracePanelOpen: false,
      traceConversationId: null,
      traceRunId: null,
      traceRefreshKey: 0,
      setTraceRun: (conversationId, runId) =>
        set({ traceConversationId: conversationId, traceRunId: runId }),
      clearTraceRun: () => set({ traceRunId: null }),
      openTracePanel: (conversationId) =>
        set((state) => ({
          tracePanelOpen: true,
          memoryPanelOpen: false,
          artifactPreview: CLOSED_ARTIFACT_PREVIEW,
          videoProductionWorkspace: CLOSED_VIDEO_PRODUCTION_WORKSPACE,
          traceConversationId: conversationId,
          traceRunId:
            state.traceConversationId === conversationId
              ? state.traceRunId
              : null,
        })),
      setTracePanelOpen: (tracePanelOpen) =>
        set((state) => ({
          tracePanelOpen,
          ...(tracePanelOpen
            ? {
                memoryPanelOpen: false,
                artifactPreview: CLOSED_ARTIFACT_PREVIEW,
                videoProductionWorkspace: CLOSED_VIDEO_PRODUCTION_WORKSPACE,
              }
            : {}),
          traceConversationId: tracePanelOpen
            ? state.traceConversationId
            : null,
        })),
      bumpTraceRefresh: () =>
        set((state) => ({ traceRefreshKey: state.traceRefreshKey + 1 })),

      artifactPreview: {
        ...CLOSED_ARTIFACT_PREVIEW,
      },
      openArtifactPreview: (conversationId, documentId) =>
        set((state) => ({
          memoryPanelOpen: false,
          tracePanelOpen: false,
          artifactPreview: {
            open: true,
            conversationId,
            documentId,
            path: null,
            token: state.artifactPreview.token + 1,
          },
          videoProductionWorkspace: CLOSED_VIDEO_PRODUCTION_WORKSPACE,
        })),
      openFilePreview: (conversationId, path) =>
        set((state) => ({
          memoryPanelOpen: false,
          tracePanelOpen: false,
          artifactPreview: {
            open: true,
            conversationId,
            documentId: null,
            path,
            token: state.artifactPreview.token + 1,
          },
          videoProductionWorkspace: CLOSED_VIDEO_PRODUCTION_WORKSPACE,
        })),
      closeArtifactPreview: () =>
        set({
          artifactPreview: CLOSED_ARTIFACT_PREVIEW,
        }),

      videoProductionWorkspace: { ...CLOSED_VIDEO_PRODUCTION_WORKSPACE },
      openVideoProductionWorkspace: (conversationId, productionId) =>
        set({
          memoryPanelOpen: false,
          tracePanelOpen: false,
          artifactPreview: CLOSED_ARTIFACT_PREVIEW,
          videoProductionWorkspace: {
            open: true,
            conversationId,
            productionId,
          },
        }),
      closeVideoProductionWorkspace: () =>
        set({ videoProductionWorkspace: CLOSED_VIDEO_PRODUCTION_WORKSPACE }),

      imagePreview: { ...CLOSED_IMAGE_PREVIEW },
      openImagePreview: (conversationId, images, index) =>
        set({
          imagePreview: {
            open: images.length > 0,
            conversationId,
            images,
            index: Math.min(Math.max(index, 0), Math.max(images.length - 1, 0)),
          },
        }),
      closeImagePreview: () =>
        set((state) => ({
          imagePreview: { ...state.imagePreview, open: false },
        })),
      setImagePreviewIndex: (index) =>
        set((state) => ({
          imagePreview: { ...state.imagePreview, index },
        })),

      conversationTitleUpdate: null,
      applyConversationTitle: (id, title) =>
        set((state) => {
          if (
            state.conversationTitleUpdate?.id === id &&
            state.conversationTitleUpdate.title === title
          ) {
            return state;
          }
          return {
            conversationTitleUpdate: {
              id,
              title,
              seq: (state.conversationTitleUpdate?.seq ?? 0) + 1,
            },
          };
        }),
    }),
    {
      name: "chat.store",
      version: 2,
      partialize: (state): Persisted => ({
        selectedAgentId: state.selectedAgentId,
      }),
    },
  ),
);

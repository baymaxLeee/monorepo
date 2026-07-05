import { type Bot, fetchBots } from "api";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ArtifactPreviewState = {
  open: boolean;
  conversationId: string | null;
  documentId: string | null;
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
  closeArtifactPreview: () => void;
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
  token: 0,
};

const CLOSED_IMAGE_PREVIEW: ImagePreviewState = {
  open: false,
  conversationId: null,
  images: [],
  index: 0,
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
          const list = await fetchBots();
          const selected = get().selectedAgentId;
          const stillExists = selected
            ? list.some((a) => a.id === selected)
            : false;
          set({
            agents: list,
            selectedAgentId: stillExists ? selected : (list[0]?.id ?? null),
          });
        } catch (error) {
          set({ agents: [], agentsError: String(error) });
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
            token: state.artifactPreview.token + 1,
          },
        })),
      closeArtifactPreview: () =>
        set({
          artifactPreview: CLOSED_ARTIFACT_PREVIEW,
        }),

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
        set((state) => ({
          conversationTitleUpdate: {
            id,
            title,
            seq: (state.conversationTitleUpdate?.seq ?? 0) + 1,
          },
        })),
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

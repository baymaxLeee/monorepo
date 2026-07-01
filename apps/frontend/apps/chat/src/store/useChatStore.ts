import { fetchModelProviders, type ModelProvider } from "api";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ArtifactPreviewState = {
  open: boolean;
  conversationId: string | null;
  documentId: string | null;
};

export type ChatUIState = {
  sendingConversationId: string | null;
  setSendingConversationId: (id: string | null) => void;
  providers: ModelProvider[] | null;
  providersError: string | null;
  isLoadingProviders: boolean;
  loadProviders: () => Promise<void>;
  selectedProviderId: string | null;
  setSelectedProviderId: (id: string | null) => void;
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
  // Cross-panel signal: a chat page auto-renamed a conversation (live, from the
  // streamed title) and the sidebar list (owned by ChatLayout) needs to reflect
  // it without a refetch. `seq` makes repeated same-title updates observable.
  conversationTitleUpdate: { id: string; title: string; seq: number } | null;
  applyConversationTitle: (id: string, title: string) => void;
};

type Persisted = Pick<ChatUIState, "selectedProviderId">;

const CLOSED_ARTIFACT_PREVIEW: ArtifactPreviewState = {
  open: false,
  conversationId: null,
  documentId: null,
};

export const useChatStore = create<ChatUIState>()(
  persist(
    (set, get) => ({
      sendingConversationId: null,
      setSendingConversationId: (sendingConversationId) =>
        set({ sendingConversationId }),

      providers: null,
      providersError: null,
      isLoadingProviders: false,
      async loadProviders() {
        if (get().isLoadingProviders) return;
        set({ isLoadingProviders: true, providersError: null });
        try {
          const list = await fetchModelProviders();
          const selected = get().selectedProviderId;
          const stillExists = selected
            ? list.find((p) => p.id === selected && p.is_enabled)
            : null;
          set({
            providers: list,
            selectedProviderId: stillExists
              ? selected
              : (list.find((p) => p.is_default && p.is_enabled)?.id ?? null),
          });
        } catch (error) {
          set({
            providers: [],
            providersError: String(error),
          });
        } finally {
          set({ isLoadingProviders: false });
        }
      },

      selectedProviderId: null,
      setSelectedProviderId: (selectedProviderId) =>
        set({ selectedProviderId }),

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
        set({
          memoryPanelOpen: false,
          tracePanelOpen: false,
          artifactPreview: { open: true, conversationId, documentId },
        }),
      closeArtifactPreview: () =>
        set({
          artifactPreview: CLOSED_ARTIFACT_PREVIEW,
        }),

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
      version: 1,
      partialize: (state): Persisted => ({
        selectedProviderId: state.selectedProviderId,
      }),
    },
  ),
);

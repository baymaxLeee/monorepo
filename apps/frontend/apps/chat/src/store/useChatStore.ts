import { fetchModelProviders, type ModelProvider } from "api";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatUIState = {
  sendingConversationId: string | null;
  setSendingConversationId: (id: string | null) => void;

  // Provider catalogue (mirror of admin/providers, refreshed on layout
  // mount). `null` means "not yet loaded"; `[]` means "loaded, empty".
  providers: ModelProvider[] | null;
  providersError: string | null;
  isLoadingProviders: boolean;
  loadProviders: () => Promise<void>;

  // User's last picked provider — persisted across reloads so a long-time
  // user doesn't re-pick on every visit. Resolved against the freshly
  // fetched provider list to handle deletions / renames gracefully.
  selectedProviderId: string | null;
  setSelectedProviderId: (id: string | null) => void;
};

type Persisted = Pick<ChatUIState, "selectedProviderId">;

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
          // Reconcile the persisted selection against reality: clear if
          // the previously selected provider was deleted or disabled.
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

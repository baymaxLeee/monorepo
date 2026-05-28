import { create } from "zustand";

export type ChatUIState = {
  sendingConversationId: string | null;
  setSendingConversationId: (id: string | null) => void;
};

export const useChatStore = create<ChatUIState>((set) => ({
  sendingConversationId: null,
  setSendingConversationId: (sendingConversationId) =>
    set({ sendingConversationId }),
}));

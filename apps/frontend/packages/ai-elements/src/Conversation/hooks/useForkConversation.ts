import { forkConversation } from "@repo/api/chat";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

export function useForkConversation(conversationId: string) {
  const navigate = useNavigate();
  return useCallback(
    async (messageId: string) => {
      const result = await forkConversation(conversationId, { message_id: messageId }, { skipErrorNotify: true });
      navigate(`/platform/chat/conversations/${result.id}`, { state: { refreshConversationHistory: true } });
    },
    [conversationId, navigate],
  );
}

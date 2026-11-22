import { ContextUsage } from "@repo/ai-elements";
import { type ConversationContextView, getConversationContext } from "@repo/api/chat";
import { useEffect, useState } from "react";

import type { ChatUIDataTypes } from "../lib/chat-message";

export function ChatContextUsage({
  conversationId,
  refreshKey,
  running,
  live,
}: {
  conversationId: string;
  refreshKey: number;
  running: boolean;
  live: ChatUIDataTypes["context-usage"] | null;
}) {
  const [state, setState] = useState<{
    conversationId: string;
    context: ConversationContextView | null;
  }>({ conversationId, context: null });
  const [loading, setLoading] = useState(false);
  const context = live ?? (state.conversationId === conversationId ? state.context : null);

  useEffect(() => {
    if (!conversationId) {
      setState({ conversationId, context: null });
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void getConversationContext(conversationId, {
      signal: controller.signal,
      skipErrorNotify: true,
    })
      .then((response) => {
        if (!controller.signal.aborted) {
          setState({ conversationId, context: response.context });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [conversationId, refreshKey]);

  return (
    <ContextUsage
      value={
        context
          ? {
              usedTokens: context.usedTokens,
              contextWindow: context.contextWindow,
              autoCompactAt: context.autoCompactAt,
              estimated: context.estimated,
              compacted: context.compacted,
              categories: context.categories,
            }
          : null
      }
      loading={loading || running}
    />
  );
}

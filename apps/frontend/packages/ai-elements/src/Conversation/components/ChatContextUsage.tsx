import { ContextUsage } from "@repo/ai-elements";
import { type ConversationContextView, getConversationContext } from "@repo/api/chat";
import { useEffect, useState } from "react";

export function ChatContextUsage({
  conversationId,
  refreshKey,
  running,
}: {
  conversationId: string;
  refreshKey: number;
  running: boolean;
}) {
  const [state, setState] = useState<{
    conversationId: string;
    context: ConversationContextView | null;
  }>({ conversationId, context: null });
  const [loading, setLoading] = useState(false);
  const context = state.conversationId === conversationId ? state.context : null;

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
              categories: context.categories,
            }
          : null
      }
      loading={loading || running}
    />
  );
}

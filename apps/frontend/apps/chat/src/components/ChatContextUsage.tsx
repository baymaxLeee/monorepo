import { type ConversationContextView, fetchConversationContext } from "api";
import { ContextUsage } from "components/ai-chat";
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
  const context =
    state.conversationId === conversationId ? state.context : null;

  useEffect(() => {
    if (!conversationId) {
      setState({ conversationId, context: null });
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void fetchConversationContext(conversationId, {
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
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [conversationId, refreshKey]);

  return (
    <ContextUsage
      usedTokens={context?.usedTokens}
      maxTokens={context?.effectiveWindow}
      contextWindow={context?.contextWindow}
      reservedOutputTokens={context?.reservedOutputTokens}
      reservedOverheadTokens={context?.reservedOverheadTokens}
      utilization={context?.utilization}
      categories={context?.categories}
      cachedInputTokens={context?.cachedInputTokens}
      model={context?.model}
      loading={loading || running}
      totalEstimated={context?.totalEstimated}
      breakdownEstimated={context?.breakdownEstimated}
    />
  );
}

import type { SourceItem } from "@repo/ai-elements";
import { fetchConversationSourceDelivery } from "@repo/api";
import { useCallback } from "react";

export function useSourceAction(conversationId: string) {
  return useCallback(
    (source: SourceItem): (() => Promise<void>) | undefined => {
      const value = source as Record<string, unknown>;
      if (value.type !== "source-document" && value.sourceType !== "document") return;
      const metadata = value.providerMetadata;
      const chat = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).chat : undefined;
      if (!chat || typeof chat !== "object" || (chat as Record<string, unknown>).resolver !== "knowledge-document")
        return;
      const id =
        typeof value.sourceId === "string" ? value.sourceId : typeof value.id === "string" ? value.id : undefined;
      if (!id) return;
      return async () => {
        // Reserve a tab during the click; awaiting authorization first triggers popup blockers.
        const tab = window.open("about:blank", "_blank");
        if (!tab) throw new Error("请允许浏览器打开新标签页后重试。");
        tab.opener = null;
        try {
          const delivery = await fetchConversationSourceDelivery(conversationId, id);
          const url = new URL(delivery.url, window.location.origin);
          if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("文档访问链接无效。");
          tab.location.replace(url.href);
        } catch (error) {
          tab.close();
          throw error;
        }
      };
    },
    [conversationId],
  );
}

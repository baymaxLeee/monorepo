import { createContext } from "react";

import type { PreparePageContext } from "./page-tools";

// An app can replace its own pending context. Acknowledging a send must not
// discard a newer selection that arrived while the model was streaming.
type CallTool = (callId: string, pluginId: string, name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

export function createMCPAppContext(callTool?: CallTool) {
  const entries = new Map<string, { text: string }>();
  return {
    callTool,
    update(call: string, text: string) {
      if (text) entries.set(call, { text });
      else entries.delete(call);
    },
    prepare(page?: PreparePageContext) {
      const prepared = page?.();
      const batch = new Map(entries);
      if (!batch.size) return prepared;
      const selection = "用户确认的工具界面数据\n" + JSON.stringify([...batch.values()]);
      return {
        text: [prepared?.text, selection].filter(Boolean).join("\n"),
        acknowledge() {
          prepared?.acknowledge();
          for (const [key, value] of batch) if (entries.get(key) === value) entries.delete(key);
        },
      };
    },
  };
}
export const MCPAppContext = createContext<ReturnType<typeof createMCPAppContext> | undefined>(undefined);

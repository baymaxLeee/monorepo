import { getErrorMessage } from "@repo/shared";
import type { ChatTransport, UIMessageChunk } from "ai";

import type { ChatUIMessage } from "./chat-message";

export type ClientToolExecutor = (name: string, input: unknown, options: { signal: AbortSignal }) => Promise<unknown>;
export type PreparePageContext = () => { text: string; acknowledge(): void } | undefined;

type PageToolResult = { tool: string; toolCallId: string } & (
  | { output: { ok: true; status: "completed"; data: unknown } }
  | { state: "output-error"; errorText: string }
);

/** Only the renderer that submitted the request can execute its live page calls.
 * Resume streams and hydrated journal messages are also shown in other tabs. */
export class PageToolSession {
  private admitted = new Set<string>();
  private turnInput?: string;
  private handled = new Set<string>();
  private lifetime = new AbortController();

  constructor(private readonly execute: ClientToolExecutor) {}

  transport(base: ChatTransport<ChatUIMessage>): ChatTransport<ChatUIMessage> {
    return {
      reconnectToStream: (options) => base.reconnectToStream(options),
      sendMessages: async (options) => {
        this.stop();
        const latest = options.messages.at(-1);
        if ((latest?.role === "user" && latest.id !== this.turnInput) || options.trigger === "regenerate-message") {
          this.handled.clear();
          this.turnInput = latest?.id;
        }
        this.lifetime = new AbortController();
        const { signal } = this.lifetime;
        const stream = await base.sendMessages(options);
        return stream.pipeThrough(
          new TransformStream<UIMessageChunk, UIMessageChunk>({
            transform: (chunk, controller) => {
              if (!signal.aborted && chunk.type === "tool-input-available" && !chunk.providerExecuted) {
                const policy = chunk.toolMetadata?.agent;
                if (
                  policy &&
                  typeof policy === "object" &&
                  "execution" in policy &&
                  "uiKind" in policy &&
                  policy.execution === "client" &&
                  policy.uiKind === "agent-ui"
                ) {
                  this.admitted.add(chunk.toolCallId);
                }
              }
              controller.enqueue(chunk);
            },
          }),
        );
      },
    };
  }

  async respond(
    call: { toolCallId: string; toolName: string; input: unknown },
    settle: (result: PageToolResult) => void | PromiseLike<void>,
  ) {
    if (!this.admitted.delete(call.toolCallId) || this.handled.has(call.toolCallId)) return;
    this.handled.add(call.toolCallId);
    const { signal } = this.lifetime;
    const identity = { tool: call.toolName, toolCallId: call.toolCallId };
    let result: PageToolResult;
    try {
      const data = await this.execute(call.toolName, call.input, { signal });
      result = { ...identity, output: { ok: true, status: "completed", data } };
    } catch (error) {
      result = { ...identity, state: "output-error", errorText: getErrorMessage(error, "页面工具执行失败") };
    }
    if (!signal.aborted) await settle(result);
  }

  stop() {
    this.lifetime.abort();
    this.admitted.clear();
  }
}

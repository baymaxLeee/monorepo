import { ExecutionLocation, ChatPrompt } from "@repo/ai-elements/conversation";
import type { PromptInputValue } from "@repo/ai-elements/prompt-input";
import { createConversation } from "@repo/api/chat";
import { getDesktopBridge } from "@repo/runtime/desktop";
import { getErrorMessage, randomId } from "@repo/shared";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export function ConversationListPage() {
  const bridge = getDesktopBridge();
  const navigate = useNavigate();
  const [location, setLocation] = useState<"cloud" | "local">("cloud");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(value: PromptInputValue) {
    if (pending.current || !value.text.trim()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (location === "local") {
        if (!bridge) throw new Error("本地电脑需要桌面应用");
        const thread = await bridge.createThread(null);
        if (!thread) return;
        // Navigate even if inference fails: the local journal retains the request and error.
        try {
          await bridge.send(thread.id, value.text, randomId());
        } finally {
          void navigate(`/platform/chat/local/${thread.id}`);
        }
      } else {
        const conversation = await createConversation({});
        void navigate(`/platform/chat/conversations/${conversation.id}`, {
          state: { refreshConversationHistory: true, externalRequest: { id: randomId(), text: value.text } },
        });
      }
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-1 items-center justify-center px-6">
        <h1 className="text-2xl font-semibold">有什么可以帮你？</h1>
      </div>
      {error ? (
        <p role="alert" className="mx-auto w-full max-w-4xl px-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ChatPrompt
        placeholder="发送消息或创建任务…"
        loading={busy}
        disabled={busy}
        maxFiles={0}
        onError={setError}
        onSubmit={(value) => void submit(value)}
        footerRender={
          bridge
            ? () => <ExecutionLocation value={location} onChange={setLocation} localAvailable disabled={busy} />
            : undefined
        }
      />
    </div>
  );
}

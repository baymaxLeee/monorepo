import { createCanvasConversation, fetchConversations } from "@repo/api";
import { ChatSession, ChatWorkspacePanel } from "@repo/chat";
import { Button } from "@repo/design-system";
import { useEffect, useState } from "react";
export function CanvasConversation({ canvasId, onChange }: { canvasId: string; onChange: () => void }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setConversationId(null);
    void fetchConversations()
      .then((items) => {
        if (active) setConversationId(items.find((item) => item.canvas_id === canvasId)?.id ?? null);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canvasId, attempt]);
  if (loading) return <div className="p-4 text-sm text-muted-foreground">读取会话…</div>;
  if (failed)
    return (
      <div className="p-4">
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          会话加载失败，重试
        </Button>
      </div>
    );
  if (!conversationId)
    return (
      <div className="flex h-full items-center justify-center">
        <Button
          disabled={creating}
          onClick={() => {
            setCreating(true);
            void createCanvasConversation(canvasId)
              .then((conversation) => setConversationId(conversation.id))
              .catch(() => {})
              .finally(() => setCreating(false));
          }}
        >
          开始画布对话
        </Button>
      </div>
    );
  return (
    <div className="relative flex h-full min-w-0 min-h-0 flex-col overflow-hidden [&_[role=log]>div]:[-ms-overflow-style:none] [&_[role=log]>div]:[scrollbar-width:none] [&_[role=log]>div::-webkit-scrollbar]:hidden">
      <ChatSession key={conversationId} conversationId={conversationId} onCanvasChange={onChange} />
      <ChatWorkspacePanel conversationId={conversationId} />
    </div>
  );
}

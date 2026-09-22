import { createCanvasConversation } from "@repo/api";
import { ChatSession, ChatWorkspacePanel } from "@repo/chat";
import { Button } from "@repo/design-system";
import { useEffect, useState } from "react";
export function CanvasConversation({
  projectId,
  canvasId,
  onChange,
  request,
}: {
  projectId: string;
  canvasId: string;
  onChange: () => void;
  request?: { id: string; text: string } | null;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setConversationId(null);
    void createCanvasConversation(projectId, canvasId)
      .then((conversation) => {
        if (active) setConversationId(conversation.id);
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
  }, [projectId, canvasId, attempt]);
  if (loading) return <div className="p-4 text-sm text-muted-foreground">读取会话…</div>;
  if (failed)
    return (
      <div className="p-4">
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          会话加载失败，重试
        </Button>
      </div>
    );
  if (!conversationId) return null;
  return (
    <div className="relative flex h-full min-w-0 min-h-0 flex-col overflow-hidden [&_[role=log]>div]:[-ms-overflow-style:none] [&_[role=log]>div]:[scrollbar-width:none] [&_[role=log]>div::-webkit-scrollbar]:hidden">
      <ChatSession
        key={conversationId}
        conversationId={conversationId}
        externalRequest={request}
        onCanvasChange={onChange}
      />
      <ChatWorkspacePanel conversationId={conversationId} />
    </div>
  );
}

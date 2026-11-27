import type { WorkspaceBridge } from "@repo/ai-elements/agent-ui";
import { ChatSession, ChatWorkspacePanel } from "@repo/ai-elements/conversation";
import { createCanvasConversation } from "@repo/api/chat";
import { Button } from "@repo/design-system";
import { randomId } from "@repo/shared";
import { useEffect, useMemo, useState } from "react";
const pageCapabilities = { client_capabilities: { ui_agent: "ui-sdk" } };

export function CanvasConversation({
  projectId,
  canvasId,
  request,
  page,
}: {
  projectId: string;
  canvasId: string;
  page: WorkspaceBridge;
  request?: { id: string; text: string } | null;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const createRequestId = useMemo(() => randomId(), [projectId, canvasId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setConversationId(null);
    void createCanvasConversation({ request_id: createRequestId, project_id: projectId, canvas_id: canvasId })
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
  }, [projectId, canvasId, attempt, createRequestId]);
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
        requestBody={pageCapabilities}
        clientToolExecutor={page.execute}
        preparePageContext={page.prepareContext}
      />
      <ChatWorkspacePanel conversationId={conversationId} />
    </div>
  );
}

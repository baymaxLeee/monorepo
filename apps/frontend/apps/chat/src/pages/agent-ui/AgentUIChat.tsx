import { AgentUIWorkspace, createWorkspaceBridge } from "@repo/ai-elements/agent-ui";
import { ChatSession } from "@repo/ai-elements/conversation";
import { buttonVariants } from "@repo/design-system";
import { cn } from "@repo/shared";
import { MessageCircleIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

const AGENT_UI_REQUEST_BODY = {
  client_capabilities: { ui_agent: "ui-sdk" },
} as const;

export function AgentUIChat() {
  const { id } = useParams<{ id: string }>();
  return id ? <Session key={id} id={id} /> : null;
}
function Session({ id }: { id: string }) {
  const [bridge] = useState(createWorkspaceBridge);
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="min-h-0 min-w-0 flex-1 basis-1/2">
        <ChatSession
          key={id}
          conversationId={id}
          requestBody={AGENT_UI_REQUEST_BODY}
          clientToolExecutor={bridge.execute}
          preparePageContext={bridge.prepareContext}
        />
      </div>
      <div className="min-h-0 min-w-[22rem] flex-1 basis-1/2 border-t lg:border-l lg:border-t-0">
        <AgentUIWorkspace
          bridge={bridge}
          headerAction={
            <Link
              to={`/platform/chat/conversations/${id}`}
              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "gap-2")}
            >
              <MessageCircleIcon className="size-4" aria-hidden="true" />
              标准会话
            </Link>
          }
        />
      </div>
    </div>
  );
}

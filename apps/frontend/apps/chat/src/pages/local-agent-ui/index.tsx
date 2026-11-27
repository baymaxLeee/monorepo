import { AgentUIWorkspace, createWorkspaceBridge } from "@repo/ai-elements/agent-ui";
import { buttonVariants } from "@repo/design-system";
import { cn } from "@repo/shared";
import { MessageCircleIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Link } from "react-router-dom";

import { LocalSessionRoute } from "../local";
import { LocalSession } from "../local/LocalSession";

export function Component() {
  return (
    <LocalSessionRoute
      uiAgent
      renderSession={({ bridge, thread, transport }) => (
        <Session key={thread.id} bridge={bridge} initial={thread} transport={transport} />
      )}
    />
  );
}
function Session({ bridge, initial: thread, transport }: ComponentProps<typeof LocalSession>) {
  const [page] = useState(createWorkspaceBridge);
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="min-h-0 min-w-0 flex-1 basis-1/2">
        <LocalSession
          key={thread.id}
          bridge={bridge}
          initial={thread}
          transport={transport}
          clientToolExecutor={page.execute}
          preparePageContext={page.prepareContext}
        />
      </div>
      <div className="min-h-0 min-w-[22rem] flex-1 basis-1/2 border-t lg:border-l lg:border-t-0">
        <AgentUIWorkspace
          bridge={page}
          headerAction={
            <Link
              to={`/platform/chat/local/${thread.id}`}
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

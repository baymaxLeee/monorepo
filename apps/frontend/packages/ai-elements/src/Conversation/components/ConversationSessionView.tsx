import type { PromptInputRef } from "@repo/ai-elements/prompt-input";
import { type RefObject, type ComponentProps, type ReactNode, useCallback, useState } from "react";

import { MCPAppContext, type createMCPAppContext } from "../lib/mcp-app-context";
import type { ActiveTodoList } from "./ChatPlanState";
import { ChatStream } from "./ChatStream";
import { MCPAppComposer } from "./MCPAppView";
import { PendingInputStack, type PendingAgentInput } from "./PendingInputStack";

type ActivePlanState = { conversationId: string; plan: ActiveTodoList };

export function ConversationSessionView({
  title,
  issue,
  composer,
  overlay,
  pendingInputs,
  promptRef,
  appContext,
  ...stream
}: ComponentProps<typeof ChatStream> & {
  title: string;
  issue?: ReactNode;
  composer: (activePlan: ActiveTodoList | null) => ReactNode;
  overlay?: ReactNode;
  appContext?: ReturnType<typeof createMCPAppContext>;
  promptRef?: RefObject<PromptInputRef | null>;
  pendingInputs?: readonly PendingAgentInput[];
}) {
  const [activePlan, setActivePlan] = useState<ActivePlanState | null>(null);
  const conversationId = stream.conversationId;
  const onActivePlanChange = useCallback(
    (plan: ActiveTodoList | null) => {
      setActivePlan((current) => {
        if (!plan) return current?.conversationId === conversationId ? null : current;
        if (current?.conversationId === conversationId && current.plan.revision === plan.revision) return current;
        return { conversationId, plan };
      });
    },
    [conversationId],
  );
  const displayedPlan = activePlan?.conversationId === conversationId ? activePlan.plan : null;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <h1 className="sr-only">{title}</h1>
      <MCPAppContext.Provider value={appContext}>
        <MCPAppComposer.Provider value={promptRef}>
          <ChatStream {...stream} onActivePlanChange={onActivePlanChange} />
        </MCPAppComposer.Provider>
      </MCPAppContext.Provider>
      <PendingInputStack inputs={pendingInputs ?? []} />
      {issue}
      {composer(displayedPlan)}
      {overlay}
    </div>
  );
}

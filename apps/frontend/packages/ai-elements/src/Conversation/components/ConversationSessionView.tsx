import { type ComponentProps, type ReactNode, useCallback, useState } from "react";

import type { ActiveTodoList } from "./ChatPlanState";
import { ChatStream } from "./ChatStream";
import { PendingInputStack, type PendingAgentInput } from "./PendingInputStack";

type ActivePlanState = { conversationId: string; plan: ActiveTodoList };

export function ConversationSessionView({
  title,
  issue,
  composer,
  overlay,
  pendingInputs,
  ...stream
}: ComponentProps<typeof ChatStream> & {
  title: string;
  issue?: ReactNode;
  composer: (activePlan: ActiveTodoList | null) => ReactNode;
  overlay?: ReactNode;
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
      <ChatStream {...stream} onActivePlanChange={onActivePlanChange} />
      <PendingInputStack inputs={pendingInputs ?? []} />
      {issue}
      {composer(displayedPlan)}
      {overlay}
    </div>
  );
}

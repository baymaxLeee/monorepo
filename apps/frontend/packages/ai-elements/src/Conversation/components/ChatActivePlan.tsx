import { memo } from "react";

import type { ActiveTodoList } from "./ChatPlanState";
import { ChatTodoListCard } from "./ChatTodoListCard";

export const ChatActivePlan = memo(function ChatActivePlan({ plan }: { plan: ActiveTodoList }) {
  return (
    <aside aria-label="任务进度" aria-live="polite" className="w-full min-w-0">
      <ChatTodoListCard todos={plan.todos} deliverableCompletion={plan.deliverableCompletion} />
    </aside>
  );
});

import {
  type AgentRunTrace,
  type AgentTraceStep,
  type AgentTraceToolCall,
  fetchConversationAgentTrace,
} from "api";
import { toast } from "components";
import {
  Plan,
  PlanContent,
  PlanHeader,
  Queue,
  QueueItem,
  Task,
  TaskDescription,
  TaskTitle,
  type WorkflowStatus,
} from "components/ai-chat";
import { useEffect, useState } from "react";

export interface ChatTracePanelProps {
  conversationId: string;
  runId: string;
  refreshKey: number;
}

function toWorkflowStatus(status: string): WorkflowStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "running":
    case "awaiting_approval":
      return "running";
    default:
      return "pending";
  }
}

export function ChatTracePanel({
  conversationId,
  runId,
  refreshKey,
}: ChatTracePanelProps) {
  const [trace, setTrace] = useState<AgentRunTrace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchConversationAgentTrace(conversationId, runId)
      .then((next) => {
        if (active) setTrace(next);
      })
      .catch((error) => toast.error(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId, runId, refreshKey]);

  const renderStep = (step: AgentTraceStep) => (
    <Task key={step.id} status={toWorkflowStatus(step.status)}>
      <TaskTitle>
        步骤 {step.stepIndex + 1} · {step.kind}
      </TaskTitle>
      {step.summary ? <TaskDescription>{step.summary}</TaskDescription> : null}
    </Task>
  );

  const renderToolCall = (call: AgentTraceToolCall) => (
    <QueueItem key={call.id} active={call.status === "running"}>
      {call.toolName}
      {call.durationMs != null ? ` · ${call.durationMs}ms` : ""}
      {call.status === "failed" ? " · 失败" : ""}
    </QueueItem>
  );

  if (loading && !trace) {
    return (
      <div className="p-4 text-xs text-muted-foreground">加载执行轨迹...</div>
    );
  }

  if (!trace) {
    return (
      <div className="p-4 text-xs text-muted-foreground">暂无执行轨迹。</div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <Plan>
        <PlanHeader title="执行步骤" status={toWorkflowStatus(trace.status)}>
          <span className="font-mono text-xs">
            {trace.model}
            {trace.totalTokens != null ? ` · ${trace.totalTokens} tokens` : ""}
          </span>
        </PlanHeader>
        <PlanContent>
          {trace.steps.length > 0 ? (
            trace.steps.map(renderStep)
          ) : (
            <p className="text-xs text-muted-foreground">暂无步骤。</p>
          )}
        </PlanContent>
      </Plan>
      {trace.toolCalls.length > 0 ? (
        <Queue>{trace.toolCalls.map(renderToolCall)}</Queue>
      ) : null}
    </div>
  );
}

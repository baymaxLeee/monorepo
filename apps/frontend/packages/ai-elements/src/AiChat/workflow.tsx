import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@repo/design-system/shadcn/trace";
import { cn } from "@repo/shared";
import { CheckCircleIcon, CircleIcon, ListTodoIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export function workflowTraceStatus(status?: WorkflowStatus) {
  return status === "running"
    ? "running"
    : status === "failed"
      ? "error"
      : status === "pending"
        ? "pending"
        : undefined;
}

function StatusIcon({ status }: { status: WorkflowStatus }) {
  if (status === "running") return <Loader2Icon className="motion-safe:animate-spin" />;
  if (status === "completed") return <CheckCircleIcon />;
  if (status === "failed" || status === "cancelled") return <XCircleIcon />;
  return <CircleIcon />;
}

export type PlanProps = ComponentProps<typeof TraceCollapsible>;
export function Plan({ className, ...props }: PlanProps) {
  return (
    <Trace>
      <TraceCollapsible defaultOpen className={className} {...props} />
    </Trace>
  );
}

export type PlanHeaderProps = Omit<ComponentProps<typeof TraceCollapsibleTrigger>, "title"> & {
  title?: ReactNode;
  status?: WorkflowStatus;
};
export function PlanHeader({ title = "计划", status, children, ...props }: PlanHeaderProps) {
  return (
    <TraceCollapsibleTrigger {...props}>
      <TraceLine status={workflowTraceStatus(status)}>
        <TraceIcon>
          <ListTodoIcon />
        </TraceIcon>
        <TraceTitle>{children ?? title}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
}

export type PlanContentProps = ComponentProps<typeof TraceCollapsibleContent>;
export function PlanContent({ children, ...props }: PlanContentProps) {
  return (
    <TraceCollapsibleContent keepMounted {...props}>
      <Trace>{children}</Trace>
    </TraceCollapsibleContent>
  );
}

export type TaskProps = HTMLAttributes<HTMLDivElement> & { status?: WorkflowStatus };
export function Task({ className, status = "pending", children, ...props }: TaskProps) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2", className)} {...props}>
      <TraceLine status={workflowTraceStatus(status)} className="mt-0.5 shrink-0">
        <TraceIcon>
          <StatusIcon status={status} />
        </TraceIcon>
      </TraceLine>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export type TaskTitleProps = ComponentProps<typeof TraceTitle>;
export function TaskTitle(props: TaskTitleProps) {
  return <TraceTitle {...props} />;
}
export type TaskDescriptionProps = ComponentProps<typeof TraceDescription>;
export function TaskDescription({ className, ...props }: TaskDescriptionProps) {
  return <TraceDescription className={cn("block whitespace-normal text-xs", className)} {...props} />;
}

export type QueueProps = ComponentProps<typeof Trace>;
export function Queue(props: QueueProps) {
  return <Trace {...props} />;
}
export type QueueItemProps = ComponentProps<typeof TraceLine> & { active?: boolean };
export function QueueItem({ active, children, ...props }: QueueItemProps) {
  return (
    <TraceLine status={active ? "running" : "pending"} {...props}>
      <TraceIcon>
        <StatusIcon status={active ? "running" : "pending"} />
      </TraceIcon>
      <TraceTitle>{children}</TraceTitle>
    </TraceLine>
  );
}

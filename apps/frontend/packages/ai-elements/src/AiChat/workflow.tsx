import { Badge } from "@repo/design-system/shadcn/badge";
import { cn } from "@repo/shared";
import { CheckCircleIcon, CircleIcon, ClockIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

function statusIcon(status: WorkflowStatus) {
  switch (status) {
    case "running":
      return <Loader2Icon className="size-4 animate-spin text-primary" />;
    case "completed":
      return <CheckCircleIcon className="size-4 text-green-600" />;
    case "failed":
    case "cancelled":
      return <XCircleIcon className="size-4 text-destructive" />;
    default:
      return <ClockIcon className="size-4 text-muted-foreground" />;
  }
}

export type PlanProps = HTMLAttributes<HTMLDivElement>;

export function Plan({ className, ...props }: PlanProps) {
  return <div className={cn("space-y-2 rounded-md border bg-background p-3", className)} {...props} />;
}

export type PlanHeaderProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode;
  status?: WorkflowStatus;
};

export function PlanHeader({ className, title = "Plan", status, children, ...props }: PlanHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)} {...props}>
      <div className="min-w-0 text-sm font-medium">{children ?? title}</div>
      {status ? (
        <Badge variant="outline" className="h-5 text-[10px]">
          {status}
        </Badge>
      ) : null}
    </div>
  );
}

export type PlanContentProps = HTMLAttributes<HTMLDivElement>;

export function PlanContent({ className, ...props }: PlanContentProps) {
  return <div className={cn("space-y-2", className)} {...props} />;
}

export type TaskProps = HTMLAttributes<HTMLDivElement> & {
  status?: WorkflowStatus;
};

export function Task({ className, status = "pending", children, ...props }: TaskProps) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2 text-sm", className)} {...props}>
      <span className="mt-0.5 shrink-0">{statusIcon(status)}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export type TaskTitleProps = HTMLAttributes<HTMLDivElement>;

export function TaskTitle({ className, ...props }: TaskTitleProps) {
  return <div className={cn("font-medium", className)} {...props} />;
}

export type TaskDescriptionProps = HTMLAttributes<HTMLDivElement>;

export function TaskDescription({ className, ...props }: TaskDescriptionProps) {
  return <div className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

export type QueueProps = HTMLAttributes<HTMLDivElement>;

export function Queue({ className, ...props }: QueueProps) {
  return <div className={cn("space-y-1 rounded-md border bg-background p-2", className)} {...props} />;
}

export type QueueItemProps = HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
};

export function QueueItem({ active, className, ...props }: QueueItemProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1.5 text-xs",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {active ? <Loader2Icon className="size-3 animate-spin" /> : <CircleIcon className="size-3" />}
      <span className="min-w-0 flex-1 truncate">{props.children}</span>
    </div>
  );
}

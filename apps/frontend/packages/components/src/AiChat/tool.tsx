import {
  CheckCircleIcon,
  ChevronRightIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "shared";
import { Badge } from "../Badge";

export type ToolState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error"
  | (string & {});

const STATUS_LABELS: Record<string, string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

function statusIcon(status: ToolState): ReactNode {
  switch (status) {
    case "approval-requested":
      return <ClockIcon className="size-4 text-yellow-600" />;
    case "approval-responded":
      return <CheckCircleIcon className="size-4 text-blue-600" />;
    case "input-available":
      return <ClockIcon className="size-4 animate-pulse" />;
    case "input-streaming":
      return <CircleIcon className="size-4" />;
    case "output-available":
      return <CheckCircleIcon className="size-4 text-green-600" />;
    case "output-denied":
      return <XCircleIcon className="size-4 text-orange-600" />;
    case "output-error":
      return <XCircleIcon className="size-4 text-red-600" />;
    default:
      return <CircleIcon className="size-4" />;
  }
}

export function getToolStatusBadge(status: ToolState) {
  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {statusIcon(status)}
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export type ToolProps = ComponentProps<"details">;

export function Tool({ className, ...props }: ToolProps) {
  return (
    <details
      className={cn(
        "group not-prose w-full rounded-md border bg-background/80",
        className,
      )}
      {...props}
    />
  );
}

export type ToolHeaderProps = ComponentProps<"summary"> & {
  title?: string;
  state: ToolState;
};

export function ToolHeader({
  className,
  title,
  state,
  children,
  ...props
}: ToolHeaderProps) {
  return (
    <summary
      className={cn(
        "flex cursor-pointer list-none items-center justify-between gap-4 p-3 marker:hidden",
        "[&::-webkit-details-marker]:hidden",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{title}</span>
            {getToolStatusBadge(state)}
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        </>
      )}
    </summary>
  );
}

export type ToolContentProps = ComponentProps<"div">;

export function ToolContent({ className, ...props }: ToolContentProps) {
  return (
    <div
      className={cn(
        "max-h-[min(24rem,60vh)] space-y-4 overflow-y-auto p-4 pt-0",
        className,
      )}
      {...props}
    />
  );
}

export type ToolJsonBlockProps = ComponentProps<"pre"> & {
  value: unknown;
};

export function ToolJsonBlock({
  className,
  value,
  ...props
}: ToolJsonBlockProps) {
  return (
    <pre
      className={cn(
        "overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed",
        className,
      )}
      {...props}
    >
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

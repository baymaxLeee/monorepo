import { Badge } from "@repo/design-system/shadcn/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@repo/design-system/shadcn/collapsible";
import { cn } from "@repo/shared";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { CheckCircleIcon, ChevronDownIcon, CircleIcon, ClockIcon, WrenchIcon, XCircleIcon } from "lucide-react";
import { isValidElement, type ComponentProps, type ReactNode } from "react";

export type ToolState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error"
  | (string & {});
export type ToolPart = ToolUIPart | DynamicToolUIPart;

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

export type ToolProps = ComponentProps<typeof Collapsible>;

export function Tool({ className, ...props }: ToolProps) {
  return (
    <Collapsible className={cn("group not-prose w-full rounded-md border bg-background/80", className)} {...props} />
  );
}

export type ToolHeaderProps = Omit<ComponentProps<typeof CollapsibleTrigger>, "type"> & {
  title?: string;
  type: ToolPart["type"];
  state: ToolState;
  toolName?: string;
};

export function ToolHeader({ className, title, type, state, toolName, children, ...props }: ToolHeaderProps) {
  const derivedName = type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");
  return (
    <CollapsibleTrigger
      className={cn("flex w-full cursor-pointer items-center justify-between gap-4 p-3", className)}
      {...props}
    >
      {children ?? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{title ?? derivedName}</span>
            {getToolStatusBadge(state)}
          </div>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export function ToolContent({ className, ...props }: ToolContentProps) {
  return (
    <CollapsibleContent
      className={cn("max-h-[min(24rem,60vh)] space-y-4 overflow-y-auto p-4 pt-0 outline-none", className)}
      {...props}
    />
  );
}

export type ToolJsonBlockProps = ComponentProps<"pre"> & {
  value: unknown;
};

export function ToolJsonBlock({ className, value, ...props }: ToolJsonBlockProps) {
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

export type ToolInputProps = ComponentProps<"div"> & { input: ToolPart["input"] };

export function ToolInput({ className, input, ...props }: ToolInputProps) {
  return (
    <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Parameters</h4>
      <ToolJsonBlock value={input} />
    </div>
  );
}

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export function ToolOutput({ className, output, errorText, ...props }: ToolOutputProps) {
  if (output == null && !errorText) {
    return null;
  }
  const renderedOutput = isValidElement(output) ? output : <ToolJsonBlock value={output} />;
  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText && "bg-destructive/10 text-destructive",
        )}
      >
        {errorText ? <div className="p-2">{errorText}</div> : null}
        {renderedOutput}
      </div>
    </div>
  );
}

export const getStatusBadge = getToolStatusBadge;

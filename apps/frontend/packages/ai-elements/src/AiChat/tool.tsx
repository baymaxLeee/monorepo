import { Badge } from "@repo/design-system/shadcn/badge";
import { CodeBlock, CodeBlockContent } from "@repo/design-system/shadcn/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@repo/design-system/shadcn/trace";
import { cn } from "@repo/shared";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { CheckCircleIcon, CircleIcon, ClockIcon, WrenchIcon, XCircleIcon } from "lucide-react";
import { isValidElement, type ComponentProps, type ReactNode, useState } from "react";

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

export type ToolProps = Omit<ComponentProps<typeof TraceCollapsible>, "defaultOpen" | "onOpenChange" | "open"> & {
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

export function Tool({ className, defaultOpen = false, onOpenChange, open, ...props }: ToolProps) {
  const [userOpen, setUserOpen] = useState<boolean>();
  const isOpen = open ?? userOpen ?? defaultOpen;
  const setIsOpen = (next: boolean) => {
    setUserOpen(next);
    onOpenChange?.(next);
  };
  return (
    <Trace className="not-prose">
      <TraceCollapsible className={className} open={isOpen} onOpenChange={setIsOpen} {...props} />
    </Trace>
  );
}

export type ToolHeaderProps = Omit<ComponentProps<typeof TraceCollapsibleTrigger>, "type"> & {
  title?: string;
  type: ToolPart["type"];
  state: ToolState;
  toolName?: string;
};

export function ToolHeader({ className, title, type, state, toolName, children, ...props }: ToolHeaderProps) {
  const derivedName = type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");
  const running = state === "input-streaming" || state === "input-available" || state === "approval-responded";
  const failed = state === "output-error";
  return (
    <TraceCollapsibleTrigger className={className} {...props}>
      {children ?? (
        <TraceLine status={failed ? "error" : running ? "running" : undefined}>
          <TraceIcon>
            <WrenchIcon />
          </TraceIcon>
          <TraceTitle>{title ?? derivedName}</TraceTitle>
          <span className="sr-only">{STATUS_LABELS[state] ?? state}</span>
        </TraceLine>
      )}
    </TraceCollapsibleTrigger>
  );
}

export type ToolContentProps = ComponentProps<typeof TraceCollapsibleContent>;

export function ToolContent({ className, ...props }: ToolContentProps) {
  return (
    <TraceCollapsibleContent
      className={cn("max-h-[min(24rem,60vh)] space-y-4 overflow-y-auto", className)}
      {...props}
    />
  );
}

export type ToolJsonBlockProps = ComponentProps<"pre"> & {
  value: unknown;
};

export function ToolJsonBlock({ className, value, ...props }: ToolJsonBlockProps) {
  return (
    <CodeBlock size="sm">
      <CodeBlockContent wrap className={cn("max-h-64", className)} {...props}>
        {typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "")}
      </CodeBlockContent>
    </CodeBlock>
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

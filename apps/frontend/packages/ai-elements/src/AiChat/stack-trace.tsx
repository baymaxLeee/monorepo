import { Button } from "@repo/design-system/shadcn/button";
import { CodeBlock, CodeBlockContent, CodeBlockCopyButton } from "@repo/design-system/shadcn/code-block";
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
import { CircleAlertIcon } from "lucide-react";
import type { ComponentProps } from "react";

export type StackTraceProps = ComponentProps<"div"> & {
  trace: string;
  onFilePathClick?: (path: string, line?: number) => void;
};
export function StackTrace({ trace, onFilePathClick, ...props }: StackTraceProps) {
  const [message, ...frames] = trace.split("\n");
  return (
    <Trace {...props}>
      <TraceCollapsible defaultOpen>
        <div className="flex min-w-0 items-center gap-2">
          <TraceCollapsibleTrigger>
            <TraceLine status="error">
              <TraceIcon>
                <CircleAlertIcon />
              </TraceIcon>
              <TraceTitle>{message}</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <CodeBlockCopyButton value={trace} />
        </div>
        <TraceCollapsibleContent>
          <CodeBlock size="sm" variant="destructive">
            <CodeBlockContent wrap className="max-h-64">
              {frames.map((frame, index) => {
                const match = frame.match(/(?:\(|\s)([^()\s]+):(\d+):(\d+)\)?$/);
                return (
                  <span key={index} className={cn("block min-h-lh", frame.includes("node_modules") && "opacity-60")}>
                    {match && onFilePathClick ? (
                      <Button
                        variant="link"
                        size="xs"
                        className="h-auto whitespace-pre-wrap p-0 font-mono text-xs"
                        onClick={() => onFilePathClick(match[1], Number(match[2]))}
                      >
                        {frame}
                      </Button>
                    ) : (
                      frame
                    )}
                  </span>
                );
              })}
            </CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

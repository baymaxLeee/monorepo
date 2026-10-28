import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockCopyButton,
} from "@repo/design-system/shadcn/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@repo/design-system/shadcn/trace";
import { useHighlightedCode } from "@repo/design-system/use-highlighted-code";
import { TerminalIcon } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";

export type TerminalProps = ComponentProps<"div"> & {
  command: string;
  output: string;
  isStreaming?: boolean;
  exitCode?: number;
  autoScroll?: boolean;
};
export function Terminal({
  command,
  output,
  isStreaming = false,
  exitCode,
  autoScroll = true,
  ...props
}: TerminalProps) {
  const [open, setOpen] = useState<boolean>();
  const viewport = useRef<HTMLPreElement>(null);
  const followsOutput = useRef(true);
  const lines = useHighlightedCode(output, "ansi");
  useEffect(() => {
    if (autoScroll && followsOutput.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [output, autoScroll]);
  return (
    <Trace {...props}>
      <TraceCollapsible open={open ?? (isStreaming && output.length > 0)} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={isStreaming ? "running" : exitCode ? "error" : undefined}>
            <TraceIcon>
              <TerminalIcon />
            </TraceIcon>
            <TraceTitle>{command}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <CodeBlock size="sm" variant={exitCode ? "destructive" : "default"}>
            <CodeBlockHeader>
              <CodeBlockTitle>{isStreaming ? "运行中" : `退出码 ${exitCode ?? 0}`}</CodeBlockTitle>
              <CodeBlockCopyButton value={output} />
            </CodeBlockHeader>
            <CodeBlockContent
              ref={viewport}
              wrap
              className="max-h-64"
              onScroll={(event) => {
                const node = event.currentTarget;
                followsOutput.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 1;
              }}
            >
              {lines.map((line, index) => (
                <span key={index} className="block min-h-lh">
                  {line}
                </span>
              ))}
            </CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

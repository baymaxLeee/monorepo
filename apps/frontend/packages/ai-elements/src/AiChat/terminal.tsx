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
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@repo/design-system/shadcn/trace";
import { useHighlightedCode } from "@repo/design-system/use-highlighted-code";
import { TerminalIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";

export type TerminalProps = ComponentProps<"div"> & {
  command: string;
  output: string;
  isStreaming?: boolean;
  exitCode?: number;
  failed?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};
export function Terminal({
  command,
  output,
  isStreaming = false,
  exitCode,
  failed = false,
  onOpenChange,
  open: controlledOpen,
  ...props
}: TerminalProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  };
  const hasError = failed || (exitCode !== undefined && exitCode !== 0);
  const lines = useHighlightedCode(output, "ansi");
  return (
    <Trace {...props}>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={isStreaming ? "running" : hasError ? "error" : exitCode === 0 ? "completed" : undefined}>
            <TraceIcon>
              <TerminalIcon />
            </TraceIcon>
            <TraceTitle>{command.split("\n")[0] || "Bash"}</TraceTitle>
            <TraceDescription>
              {isStreaming
                ? "运行中"
                : hasError
                  ? exitCode === undefined
                    ? "执行失败"
                    : `失败（退出码 ${exitCode}）`
                  : "已完成"}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-3">
          <CodeBlock size="sm">
            <CodeBlockHeader>
              <CodeBlockTitle>命令</CodeBlockTitle>
              <CodeBlockCopyButton value={command} />
            </CodeBlockHeader>
            <CodeBlockContent wrap>{command}</CodeBlockContent>
          </CodeBlock>
          <CodeBlock size="sm" variant={hasError ? "destructive" : "default"}>
            <CodeBlockHeader>
              <CodeBlockTitle>
                {isStreaming ? "运行中" : exitCode === undefined ? "输出" : `退出码 ${exitCode}`}
              </CodeBlockTitle>
              <CodeBlockCopyButton value={output} />
            </CodeBlockHeader>
            <CodeBlockContent wrap>
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

import { TestResults } from "@repo/ai-elements";
import { Skeleton } from "@repo/design-system";
import { lazy, memo, Suspense, useMemo } from "react";

import { parseTapResults } from "../lib/tap-results";
import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";
import { useToolDisclosure } from "./useToolDisclosure";

const Terminal = lazy(() => import("@repo/ai-elements/terminal").then((module) => ({ default: module.Terminal })));

export function ChatTerminalTool({
  input,
  output,
  errorText,
  running,
}: {
  input: unknown;
  output: unknown;
  errorText?: string;
  running: boolean;
}) {
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const outcome = parseToolOutcome(output);
  const payload = outcome ? toolOutcomePayload(outcome) : output;
  const result = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const exitCode = result.exit_code;
  const stdout = typeof result.output === "string" ? result.output : "";
  const failure = errorText ?? (outcome?.ok === false ? outcome.error.message : undefined);
  const disclosure = useToolDisclosure(!running);
  return (
    <TerminalContent
      command={
        typeof args.cmd === "string"
          ? args.cmd
          : typeof args.session_id === "number"
            ? `终端 ${args.session_id}`
            : "运行命令"
      }
      stdout={stdout}
      failure={failure}
      running={running}
      {...disclosure}
      exitCode={typeof exitCode === "number" ? exitCode : undefined}
    />
  );
}

// SDK snapshots can recreate tool objects. Primitive props keep a completed
// terminal independent of subsequent assistant text chunks.
const TerminalContent = memo(function TerminalContent({
  command,
  stdout,
  failure,
  running,
  open,
  onOpenChange,
  exitCode,
}: {
  command: string;
  stdout: string;
  failure?: string;
  running: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exitCode?: number;
}) {
  const suites = useMemo(() => (!running ? parseTapResults(stdout) : null), [stdout, running]);
  const output = useMemo(() => [stdout, failure].filter(Boolean).join("\n"), [stdout, failure]);
  return (
    <>
      {suites && <TestResults suites={suites} />}
      <Suspense fallback={<Skeleton className="h-5 w-48" />}>
        <Terminal
          command={command}
          output={output}
          isStreaming={running}
          failed={failure !== undefined || (exitCode !== undefined && exitCode !== 0)}
          exitCode={exitCode}
          open={open}
          onOpenChange={onOpenChange}
        />
      </Suspense>
    </>
  );
});

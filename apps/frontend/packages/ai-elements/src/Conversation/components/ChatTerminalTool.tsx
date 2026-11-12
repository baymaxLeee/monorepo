import { TestResults } from "@repo/ai-elements";
import { Skeleton } from "@repo/design-system";
import { lazy, memo, Suspense, useMemo } from "react";

import { parseTapResults } from "../lib/tap-results";
import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";

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
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const failure = errorText ?? (outcome?.ok === false ? outcome.error.message : undefined);
  return (
    <TerminalContent
      command={typeof args.command === "string" ? args.command : "运行命令"}
      stdout={stdout}
      stderr={stderr}
      failure={failure}
      running={running}
      exitCode={typeof result.exitCode === "number" ? result.exitCode : failure ? 1 : undefined}
    />
  );
}

// SDK snapshots can recreate tool objects. Primitive props keep a completed
// terminal independent of subsequent assistant text chunks.
const TerminalContent = memo(function TerminalContent({
  command,
  stdout,
  stderr,
  failure,
  running,
  exitCode,
}: {
  command: string;
  stdout: string;
  stderr: string;
  failure?: string;
  running: boolean;
  exitCode?: number;
}) {
  const suites = useMemo(() => (!running ? parseTapResults(stdout) : null), [stdout, running]);
  const output = useMemo(
    () => [stdout, stderr, failure !== stderr ? failure : undefined].filter(Boolean).join("\n"),
    [stdout, stderr, failure],
  );
  return (
    <>
      {suites && <TestResults suites={suites} />}
      <Suspense fallback={<Skeleton className="h-5 w-48" />}>
        <Terminal command={command} output={output} isStreaming={running} exitCode={exitCode} />
      </Suspense>
    </>
  );
});

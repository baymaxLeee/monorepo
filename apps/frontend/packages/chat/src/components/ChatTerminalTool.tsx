import { ToolJsonBlock } from "@repo/ai-elements";
import { lazy, Suspense } from "react";

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
    <Suspense fallback={<ToolJsonBlock value={output ?? input} />}>
      <Terminal
        command={typeof args.command === "string" ? args.command : "运行命令"}
        output={[stdout, stderr, failure !== stderr ? failure : undefined].filter(Boolean).join("\n")}
        isStreaming={running}
        exitCode={typeof result.exitCode === "number" ? result.exitCode : failure ? 1 : undefined}
      />
    </Suspense>
  );
}

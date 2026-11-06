import { Subagent, SubagentContent, SubagentHeader } from "@repo/ai-elements";

import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";
import { ChatFileTree } from "./ChatFileTree";

export function ChatDelegatedTasks({
  output,
  errorText,
  onOpenFile,
  onOpenArtifact,
}: {
  output: unknown;
  errorText?: string;
  onOpenFile: (path: string) => void;
  onOpenArtifact: (id: string) => void;
}) {
  const outcome = parseToolOutcome(output);
  const data = outcome ? toolOutcomePayload(outcome) : undefined;
  const value = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const failure = errorText || (outcome?.ok === false ? outcome.error.message : undefined);
  const status = failure ? "failed" : outcome?.status === "completed" ? "completed" : "running";
  const paths = Array.isArray(value.paths)
    ? value.paths.filter((path): path is string => typeof path === "string")
    : [];
  const progress =
    typeof value.done === "number" && typeof value.total === "number" ? ` · ${value.done}/${value.total}` : "";
  return (
    <Subagent defaultOpen={Boolean(failure)}>
      <SubagentHeader
        name={`并发文件任务 · ${failure ? "失败" : status === "completed" ? "已完成" : "运行中"}${progress}`}
        status={status}
      />
      {failure && (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {failure}
        </p>
      )}
      <SubagentContent>
        {status === "completed" ? (
          <ChatFileTree
            files={paths.map((path) => ({ path }))}
            onOpenFile={onOpenFile}
            onOpenArtifact={onOpenArtifact}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {failure ? "已保留错误详情；不会自动重试。" : "工作进度由后台任务更新，完成后可预览已保存的文件。"}
          </p>
        )}
      </SubagentContent>
    </Subagent>
  );
}

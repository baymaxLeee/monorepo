import { Tool, ToolContent, ToolHeader } from "components/ai-chat";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";

import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";

type ValidationPayload = {
  phase?: string;
  valid?: boolean;
  errors: unknown[];
  advisories: unknown[];
  diagnostics: Array<{ severity?: unknown }>;
};

function validationPayload(output: unknown): ValidationPayload | null {
  const outcome = parseToolOutcome(output);
  if (!outcome) return null;
  const payload = toolOutcomePayload(outcome);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const value = payload as Record<string, unknown>;
  return {
    ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
    ...(typeof value.valid === "boolean" ? { valid: value.valid } : {}),
    errors: Array.isArray(value.errors) ? value.errors : [],
    advisories: Array.isArray(value.advisories) ? value.advisories : [],
    diagnostics: Array.isArray(value.diagnostics)
      ? (value.diagnostics as Array<{ severity?: unknown }>)
      : [],
  };
}

export function ChatValidationCard({
  output,
  state,
  errorText,
}: {
  output: unknown;
  state: string;
  errorText?: string;
}) {
  const outcome = parseToolOutcome(output);
  const payload = validationPayload(output);
  const failed =
    state === "output-error" || (outcome != null && outcome.ok === false);
  const running =
    !failed &&
    (outcome?.status === "running" ||
      state === "input-streaming" ||
      state === "input-available");
  const message = failed
    ? "检查失败"
    : running && payload?.phase === "content_review"
      ? "正在进行内容复核"
      : running
        ? "正在进行确定性检查"
        : payload?.valid === true
          ? "未发现确定性问题"
          : "发现可供 Agent 判断的问题";
  const Icon = failed
    ? XCircleIcon
    : running
      ? Loader2Icon
      : payload?.valid === true
        ? CheckCircle2Icon
        : AlertTriangleIcon;
  const errorCount = payload
    ? payload.diagnostics.length > 0
      ? payload.diagnostics.filter((item) => item.severity === "error").length
      : payload.errors.length
    : 0;
  const warningCount = payload
    ? payload.diagnostics.length > 0
      ? payload.diagnostics.filter((item) => item.severity === "warning").length
      : payload.advisories.length
    : 0;

  return (
    <Tool open={failed || running || payload?.valid === false}>
      <ToolHeader title="HTML 检查" state={failed ? "output-error" : state} />
      <ToolContent>
        <div className="flex items-start gap-2 px-3 py-3 text-xs">
          <Icon
            className={`mt-0.5 size-4 shrink-0 ${running ? "animate-spin" : ""}`}
          />
          <div className="space-y-1">
            <div>{message}</div>
            {!running && !failed ? (
              <div className="text-muted-foreground">
                确定性问题 {errorCount} 个{` · 建议 ${warningCount} 个`}
              </div>
            ) : null}
            {failed ? (
              <div className="text-destructive">
                {errorText ??
                  (outcome && outcome.ok === false
                    ? outcome.error.message
                    : "检查工具未完成")}
              </div>
            ) : null}
          </div>
        </div>
      </ToolContent>
    </Tool>
  );
}

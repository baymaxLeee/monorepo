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
};

function validationPayload(output: unknown): ValidationPayload | null {
  const outcome = parseToolOutcome(output);
  if (!outcome) return null;
  const payload = toolOutcomePayload(outcome);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  return {
    ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
    ...(typeof value.valid === "boolean" ? { valid: value.valid } : {}),
    errors: Array.isArray(value.errors) ? value.errors : [],
    advisories: Array.isArray(value.advisories) ? value.advisories : [],
  };
}

export function ChatValidationCard({
  output,
  state,
  errorText,
  noProgress,
}: {
  output: unknown;
  state: string;
  errorText?: string;
  noProgress: boolean;
}) {
  const outcome = parseToolOutcome(output);
  const payload = validationPayload(output);
  const failed =
    noProgress ||
    state === "output-error" ||
    (outcome != null && outcome.ok === false);
  const running =
    !failed &&
    (outcome?.status === "running" ||
      state === "input-streaming" ||
      state === "input-available");
  const message = failed
    ? noProgress
      ? "校验无进展，已停止自动修复"
      : "校验失败"
    : running && payload?.phase === "content_review"
      ? "正在进行内容复核"
      : running
        ? "正在进行确定性检查"
        : payload?.valid === true
          ? "校验通过"
          : "发现确定性问题，需要修复";
  const Icon = failed
    ? XCircleIcon
    : running
      ? Loader2Icon
      : payload?.valid === true
        ? CheckCircle2Icon
        : AlertTriangleIcon;

  return (
    <Tool open={failed || running || payload?.valid === false}>
      <ToolHeader title="HTML 校验" state={failed ? "output-error" : state} />
      <ToolContent>
        <div className="flex items-start gap-2 px-3 py-3 text-xs">
          <Icon
            className={`mt-0.5 size-4 shrink-0 ${running ? "animate-spin" : ""}`}
          />
          <div className="space-y-1">
            <div>{message}</div>
            {!running && !failed ? (
              <div className="text-muted-foreground">
                确定性问题 {payload?.errors.length ?? 0} 个
                {` · advisory ${payload?.advisories.length ?? 0} 个`}
              </div>
            ) : null}
            {failed ? (
              <div className="text-destructive">
                {noProgress
                  ? "确定性问题指纹已在本轮出现过。"
                  : (errorText ??
                    (outcome && outcome.ok === false
                      ? outcome.error.message
                      : "质量门未完成"))}
              </div>
            ) : null}
          </div>
        </div>
      </ToolContent>
    </Tool>
  );
}

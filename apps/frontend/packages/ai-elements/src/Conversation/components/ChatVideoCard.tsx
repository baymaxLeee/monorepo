import { Loader2Icon, PlaySquareIcon } from "lucide-react";

import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";
import { ChatMediaCard } from "./ChatMediaCard";

export type GenerateVideoOutput = {
  ok: boolean;
  status: string;
  prompt?: string;
  fileId?: string;
  error?: string;
};

export function parseGenerateVideoOutput(output: unknown): GenerateVideoOutput | null {
  if (!output || typeof output !== "object") {
    return null;
  }
  const outcome = parseToolOutcome(output);
  if (!outcome) {
    return null;
  }
  const payload = toolOutcomePayload(outcome);
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const file = raw.file && typeof raw.file === "object" ? (raw.file as Record<string, unknown>) : {};
  return {
    ok: outcome.ok,
    status: outcome.status === "partial" ? "partial" : typeof raw.status === "string" ? raw.status : outcome.status,
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    fileId: typeof file.file_id === "string" ? file.file_id : undefined,
    error: outcome.ok === false ? outcome.error.message : undefined,
  };
}

export function ChatVideoCard({
  output,
  state,
  errorText,
  onOpen,
}: {
  output: unknown;
  state: string;
  errorText?: string;
  onOpen: (fileId: string) => void;
}) {
  const parsed = parseGenerateVideoOutput(output);
  const failed = state === "output-error" || parsed?.ok === false;
  const fileId = parsed?.fileId ?? null;
  const completed = parsed?.status === "completed" && Boolean(fileId);

  if (failed) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
        {errorText?.trim() || parsed?.error?.trim() || "视频生成失败。"}
      </div>
    );
  }

  if (completed && fileId) {
    return (
      <ChatMediaCard icon={PlaySquareIcon} title="视频" description="点击在侧栏预览" onOpen={() => onOpen(fileId)} />
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 shrink-0 animate-spin" />
      <span className="truncate">{parsed?.prompt ? `正在生成视频：${parsed.prompt}` : "正在生成视频…"}</span>
    </div>
  );
}

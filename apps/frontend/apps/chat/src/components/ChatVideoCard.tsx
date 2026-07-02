import { Loader2Icon } from "lucide-react";
import { useDocumentBlobUrl } from "../hooks/useDocumentSource";

export type GenerateVideoOutput = {
  ok: boolean;
  status: string;
  prompt?: string;
  documentId?: string;
  error?: string;
};

// generate_video is a durable-task tool: it yields a preliminary
// `{ status: "queued"|"running", task_id }` (so this card mounts and shows a
// generating state on the main chat stream), then a terminal
// `{ status: "completed", document_id }` (or `{ ok: false, error }`). No task
// SSE subscription is needed — the tool foreground-blocks and streams both
// yields over the same chat stream.
export function parseGenerateVideoOutput(
  output: unknown,
): GenerateVideoOutput | null {
  if (!output || typeof output !== "object") return null;
  const raw = output as Record<string, unknown>;
  return {
    ok: raw.ok !== false,
    status: typeof raw.status === "string" ? raw.status : "generating",
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    documentId:
      typeof raw.document_id === "string" ? raw.document_id : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

export function ChatVideoCard({
  conversationId,
  output,
  state,
  onOpen,
}: {
  conversationId: string;
  output: unknown;
  state: string;
  onOpen: (documentId: string) => void;
}) {
  const parsed = parseGenerateVideoOutput(output);
  const failed = state === "output-error" || parsed?.ok === false;
  const documentId = parsed?.documentId ?? null;
  const completed = parsed?.status === "completed" && Boolean(documentId);
  const { blobUrl, loading, error } = useDocumentBlobUrl(
    conversationId,
    documentId,
    completed,
  );

  if (failed) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
        {parsed?.error?.trim() || "视频生成失败。"}
      </div>
    );
  }

  if (completed && documentId) {
    return (
      <div className="space-y-1.5">
        {blobUrl ? (
          <video
            src={blobUrl}
            controls
            className="max-h-[24rem] w-full rounded-lg border bg-black"
          >
            {/* Generated videos have no caption track; element provided to
                satisfy a11y lint. */}
            <track kind="captions" />
          </video>
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-lg border bg-muted/20 text-xs text-muted-foreground">
            {loading ? (
              <Loader2Icon className="size-5 animate-spin" />
            ) : error ? (
              "加载失败"
            ) : (
              "视频"
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => onOpen(documentId)}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          在侧栏预览
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 shrink-0 animate-spin" />
      <span className="truncate">
        {parsed?.prompt
          ? `正在生成视频(通常需要几十秒到几分钟):${parsed.prompt}`
          : "正在生成视频,通常需要几十秒到几分钟…"}
      </span>
    </div>
  );
}

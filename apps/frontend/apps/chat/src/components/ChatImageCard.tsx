import { ImageIcon, Loader2Icon } from "lucide-react";

import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";
import { useChatStore } from "../store/useChatStore";
import { ChatMediaCard } from "./ChatMediaCard";

export type GeneratedImageRef = {
  documentId: string;
  filename: string;
  mediaType: string;
};

export type GenerateImageOutput = {
  ok: boolean;
  status: string;
  images: GeneratedImageRef[];
  error?: string;
  count?: number;
  failed?: number;
};

export function parseGenerateImageOutput(output: unknown): GenerateImageOutput | null {
  if (!output || typeof output !== "object") {
    return null;
  }
  const outcome = parseToolOutcome(output);
  if (!outcome) {
    return null;
  }
  const payload = toolOutcomePayload(outcome);
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const images = Array.isArray(raw.images)
    ? raw.images.flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const row = item as Record<string, unknown>;
        if (typeof row.document_id !== "string") {
          return [];
        }
        return [
          {
            documentId: row.document_id,
            filename: typeof row.filename === "string" ? row.filename : "image",
            mediaType: typeof row.media_type === "string" ? row.media_type : "image/png",
          },
        ];
      })
    : [];
  return {
    ok: outcome.ok,
    status:
      outcome.status === "partial"
        ? "partial"
        : typeof raw.status === "string"
          ? raw.status
          : outcome.status === "completed" || images.length > 0
            ? "completed"
            : "generating",
    images,
    error: outcome.ok === false ? outcome.error.message : undefined,
    count: typeof raw.count === "number" ? raw.count : undefined,
    failed: typeof raw.failed === "number" ? raw.failed : undefined,
  };
}

export function ChatImageCard({
  conversationId,
  output,
  state,
  errorText,
}: {
  conversationId: string;
  output: unknown;
  state: string;
  errorText?: string;
}) {
  const openImagePreview = useChatStore((s) => s.openImagePreview);
  const parsed = parseGenerateImageOutput(output);
  const failed = state === "output-error" || parsed?.ok === false;

  const images = parsed?.images ?? [];
  if ((parsed?.status === "completed" || parsed?.status === "partial") && images.length > 0) {
    const refs = images.map((image) => ({
      documentId: image.documentId,
      filename: image.filename,
    }));
    const skipped = parsed.failed ?? 0;
    return (
      <ChatMediaCard
        icon={ImageIcon}
        title={images.length > 1 ? "图片组" : "图片"}
        description={`共 ${images.length} 张`}
        note={skipped > 0 ? `${skipped} 张生成失败${parsed.error ? `：${parsed.error}` : ""}` : undefined}
        onOpen={() => openImagePreview(conversationId, refs, 0)}
      />
    );
  }

  if (failed) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
        {errorText?.trim() || parsed?.error?.trim() || "图片生成失败。"}
      </div>
    );
  }

  const generatingCount = parsed?.count ?? 0;
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 shrink-0 animate-spin" />
      <span className="truncate">{generatingCount > 1 ? `正在生成 ${generatingCount} 张图片…` : "正在生成图片…"}</span>
    </div>
  );
}

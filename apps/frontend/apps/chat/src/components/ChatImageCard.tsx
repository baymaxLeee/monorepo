import { Loader2Icon } from "lucide-react";
import { cn } from "shared";
import { useDocumentBlobUrl } from "../hooks/useDocumentSource";

export type GeneratedImageRef = {
  documentId: string;
  filename: string;
  mediaType: string;
};

export type GenerateImageOutput = {
  ok: boolean;
  status: string;
  prompt?: string;
  images: GeneratedImageRef[];
  error?: string;
  count?: number;
};

// generate_image is an inline async-generator tool: it yields a preliminary
// `{ status: "generating" }` so this card can mount immediately, then a final
// `{ status: "completed", images: [...] }` (or `{ ok: false, error }`). The AI
// SDK persists the last yield, so a reloaded conversation renders straight from
// the terminal output.
export function parseGenerateImageOutput(
  output: unknown,
): GenerateImageOutput | null {
  if (!output || typeof output !== "object") return null;
  const raw = output as Record<string, unknown>;
  const images = Array.isArray(raw.images)
    ? raw.images.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.document_id !== "string") return [];
        return [
          {
            documentId: row.document_id,
            filename: typeof row.filename === "string" ? row.filename : "image",
            mediaType:
              typeof row.media_type === "string" ? row.media_type : "image/png",
          },
        ];
      })
    : [];
  return {
    ok: raw.ok !== false,
    status:
      typeof raw.status === "string"
        ? raw.status
        : images.length > 0
          ? "completed"
          : "generating",
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    images,
    error: typeof raw.error === "string" ? raw.error : undefined,
    count: typeof raw.count === "number" ? raw.count : undefined,
  };
}

function GeneratedImageTile({
  conversationId,
  image,
  onOpen,
}: {
  conversationId: string;
  image: GeneratedImageRef;
  onOpen: (documentId: string) => void;
}) {
  const { blobUrl, loading, error } = useDocumentBlobUrl(
    conversationId,
    image.documentId,
    true,
  );
  return (
    <button
      type="button"
      title={`预览 ${image.filename}`}
      onClick={() => onOpen(image.documentId)}
      className="group relative overflow-hidden rounded-lg border bg-muted/20 transition-colors hover:border-primary/60"
    >
      {blobUrl ? (
        <img
          src={blobUrl}
          alt={image.filename}
          className="max-h-[22rem] w-full object-contain"
        />
      ) : (
        <div className="flex aspect-square w-full min-w-[8rem] items-center justify-center text-xs text-muted-foreground">
          {loading ? (
            <Loader2Icon className="size-5 animate-spin" />
          ) : error ? (
            "加载失败"
          ) : (
            "图片"
          )}
        </div>
      )}
    </button>
  );
}

export function ChatImageCard({
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
  const parsed = parseGenerateImageOutput(output);
  const failed = state === "output-error" || parsed?.ok === false;

  if (failed) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
        {parsed?.error?.trim() || "图片生成失败。"}
      </div>
    );
  }

  const images = parsed?.images ?? [];
  if (parsed?.status === "completed" && images.length > 0) {
    return (
      <div
        className={cn(
          "grid gap-2",
          images.length > 1 ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {images.map((image) => (
          <GeneratedImageTile
            key={image.documentId}
            conversationId={conversationId}
            image={image}
            onOpen={onOpen}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 shrink-0 animate-spin" />
      <span className="truncate">
        {parsed?.prompt ? `正在生成图片：${parsed.prompt}` : "正在生成图片…"}
      </span>
    </div>
  );
}

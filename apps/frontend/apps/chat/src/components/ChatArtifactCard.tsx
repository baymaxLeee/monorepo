import type { ConversationDocument } from "api";
import { Button } from "components";
import {
  Artifact,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "components/ai-chat";
import { FileTextIcon } from "lucide-react";
import { useEffect, useRef } from "react";

export type ArtifactOutput = {
  documentId: string;
  status: string;
  title: string;
  filename: string;
  kind: string;
  content: string;
  totalChars?: number;
};

export function parseArtifactOutput(output: unknown): ArtifactOutput | null {
  if (!output || typeof output !== "object") return null;
  const raw = output as {
    document_id?: unknown;
    status?: unknown;
    title?: unknown;
    filename?: unknown;
    kind?: unknown;
    content?: unknown;
    total_chars?: unknown;
  };
  if (typeof raw.document_id !== "string" && raw.status !== "generating") {
    return null;
  }
  return {
    documentId: typeof raw.document_id === "string" ? raw.document_id : "",
    status: typeof raw.status === "string" ? raw.status : "persisted",
    title: typeof raw.title === "string" ? raw.title : "Artifact",
    filename: typeof raw.filename === "string" ? raw.filename : "artifact",
    kind: typeof raw.kind === "string" ? raw.kind : "file",
    content: typeof raw.content === "string" ? raw.content : "",
    totalChars:
      typeof raw.total_chars === "number" ? raw.total_chars : undefined,
  };
}

export type ArtifactStreamData = {
  toolCallId: string;
  status: "generating" | "persisted" | "error";
  title: string;
  filename: string;
  kind: string;
  preview: string;
  generated_chars: number;
  document_id?: string;
};

export function parseArtifactStreamData(
  data: unknown,
): ArtifactStreamData | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  const status = raw.status;
  if (status !== "generating" && status !== "persisted" && status !== "error") {
    return null;
  }
  return {
    toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : "",
    status,
    title: typeof raw.title === "string" ? raw.title : "Artifact",
    filename: typeof raw.filename === "string" ? raw.filename : "artifact",
    kind: typeof raw.kind === "string" ? raw.kind : "file",
    preview: typeof raw.preview === "string" ? raw.preview : "",
    generated_chars:
      typeof raw.generated_chars === "number" ? raw.generated_chars : 0,
    document_id:
      typeof raw.document_id === "string" ? raw.document_id : undefined,
  };
}

export function StreamingArtifactCard({
  artifact,
}: {
  artifact: ArtifactOutput;
}) {
  return (
    <Artifact>
      <ArtifactHeader>
        <div className="min-w-0">
          <ArtifactTitle className="truncate">{artifact.title}</ArtifactTitle>
          <ArtifactDescription className="truncate">
            {artifact.kind} · {artifact.filename} · {artifact.status}
            {artifact.totalChars ? ` · ${artifact.totalChars} chars` : ""}
          </ArtifactDescription>
        </div>
      </ArtifactHeader>
      <ArtifactContent>
        <ArtifactStreamPreview content={artifact.content || "artifact"} />
      </ArtifactContent>
    </Artifact>
  );
}

function ArtifactStreamPreview({ content }: { content: string }) {
  const previewRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [content]);

  return (
    <pre
      ref={previewRef}
      className="max-h-[6.25rem] overflow-hidden whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-[11px] leading-5"
    >
      {content}
    </pre>
  );
}

export function ArtifactDocumentCard({
  document,
  documentId,
  fallback,
  onOpen,
}: {
  document: ConversationDocument | undefined;
  documentId: string;
  fallback?: ArtifactOutput;
  onOpen: () => void;
}) {
  return (
    <Artifact>
      <ArtifactHeader>
        <div className="min-w-0">
          <ArtifactTitle className="truncate">
            {document?.title ?? fallback?.title ?? documentId}
          </ArtifactTitle>
          <ArtifactDescription className="truncate">
            {[
              document?.kind ?? "artifact",
              document?.filename ?? fallback?.filename,
              document?.mime_type,
            ]
              .filter(Boolean)
              .join(" · ")}
          </ArtifactDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onOpen}>
          预览
        </Button>
      </ArtifactHeader>
      <ArtifactContent className="px-4 py-3 text-xs text-muted-foreground">
        <FileTextIcon className="mr-1 inline size-3" />
        AI artifact
      </ArtifactContent>
    </Artifact>
  );
}

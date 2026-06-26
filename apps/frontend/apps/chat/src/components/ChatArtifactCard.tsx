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

export type ArtifactOutput = {
  documentId: string;
  status: string;
  title: string;
  filename: string;
  kind: string;
  content: string;
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
          </ArtifactDescription>
        </div>
      </ArtifactHeader>
      <ArtifactContent>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-[11px]">
          {artifact.content || "artifact"}
        </pre>
      </ArtifactContent>
    </Artifact>
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

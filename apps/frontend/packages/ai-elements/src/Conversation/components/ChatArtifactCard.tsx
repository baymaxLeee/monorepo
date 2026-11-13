import { Artifact, ArtifactContent, ArtifactDescription, ArtifactHeader, ArtifactTitle } from "@repo/ai-elements";
import { type ConversationDocument } from "@repo/api/chat";
import { Button } from "@repo/design-system";
import { FileTextIcon } from "lucide-react";

import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";

export type ArtifactOutput = {
  documentId?: string;
  fileId?: string;
  status: string;
  title: string;
  filename: string;
  kind: string;
  totalChars?: number;
};

export function parseArtifactOutput(output: unknown): ArtifactOutput | null {
  const outcome = parseToolOutcome(output);
  if (!outcome || outcome.ok === false) {
    return null;
  }
  const payload = toolOutcomePayload(outcome);
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  if (typeof raw.task_id === "string") {
    return null;
  }
  const documentId = typeof raw.document_id === "string" ? raw.document_id : undefined;
  const fileId = typeof raw.file_id === "string" ? raw.file_id : undefined;
  if (!documentId && !fileId) {
    return null;
  }
  const filename = typeof raw.filename === "string" ? raw.filename : "artifact";
  return {
    documentId,
    fileId,
    status: typeof raw.status === "string" ? raw.status : "persisted",
    title: typeof raw.title === "string" ? raw.title : filename,
    filename,
    kind: typeof raw.kind === "string" ? raw.kind : "artifact",
    totalChars: typeof raw.total_chars === "number" ? raw.total_chars : undefined,
  };
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
          <ArtifactTitle className="truncate">{document?.title ?? fallback?.title ?? documentId}</ArtifactTitle>
          <ArtifactDescription className="truncate">
            {[document?.kind ?? "artifact", document?.filename ?? fallback?.filename, document?.mime_type]
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

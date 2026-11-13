import { parseToolOutcome, toolOutcomePayload } from "./tool-outcome";

export type ArtifactOutput = {
  documentId?: string;
  fileId?: string;
  status: string;
  title: string;
  filename: string;
  kind: string;
  totalChars?: number;
};

export function parseArtifactOutputs(output: unknown): ArtifactOutput[] {
  const outcome = parseToolOutcome(output);
  if (!outcome || outcome.ok === false) {
    return [];
  }
  const payload = toolOutcomePayload(outcome);
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const payloadRecord = payload as Record<string, unknown>;
  const values = Array.isArray(payloadRecord.files) ? payloadRecord.files : [payloadRecord];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const raw = value as Record<string, unknown>;
    if (typeof raw.task_id === "string") return [];
    const documentId = typeof raw.document_id === "string" ? raw.document_id : undefined;
    const fileId = typeof raw.file_id === "string" ? raw.file_id : undefined;
    if (!documentId && !fileId) return [];
    const filename = typeof raw.filename === "string" ? raw.filename : "artifact";
    return [
      {
        documentId,
        fileId,
        status: typeof raw.status === "string" ? raw.status : "persisted",
        title: typeof raw.title === "string" ? raw.title : filename,
        filename,
        kind: typeof raw.kind === "string" ? raw.kind : "artifact",
        totalChars: typeof raw.total_chars === "number" ? raw.total_chars : undefined,
      },
    ];
  });
}

export function parseArtifactOutput(output: unknown): ArtifactOutput | null {
  return parseArtifactOutputs(output)[0] ?? null;
}

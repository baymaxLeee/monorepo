import type { ConversationDocument, TaskStatus } from "api";
import { Button } from "components";
import {
  Artifact,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "components/ai-chat";
import { FileTextIcon, Loader2Icon } from "lucide-react";
import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";

export type ArtifactOutput = {
  documentId: string;
  status: string;
  title: string;
  filename: string;
  kind: string;
  totalChars?: number;
};

export function parseArtifactOutput(output: unknown): ArtifactOutput | null {
  const outcome = parseToolOutcome(output);
  if (!outcome || outcome.ok === false) return null;
  const payload = toolOutcomePayload(outcome);
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.document_id !== "string") return null;
  return {
    documentId: raw.document_id,
    status: typeof raw.status === "string" ? raw.status : "persisted",
    title: typeof raw.title === "string" ? raw.title : "Artifact",
    filename: typeof raw.filename === "string" ? raw.filename : "artifact",
    kind: typeof raw.kind === "string" ? raw.kind : "file",
    totalChars:
      typeof raw.total_chars === "number" ? raw.total_chars : undefined,
  };
}

export type ArtifactTaskOutput = {
  taskId: string;
  title: string;
  filename: string;
  kind: string;
  status?: TaskStatus;
  blocksDone?: number;
  blocksTotal?: number;
  documentId?: string;
  totalChars?: number;
  error?: string;
};

export function parseArtifactTaskOutput(
  output: unknown,
): ArtifactTaskOutput | null {
  const outcome = parseToolOutcome(output);
  if (!outcome) return null;
  const payload = toolOutcomePayload(outcome);
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.task_id !== "string") return null;
  return {
    taskId: raw.task_id,
    title: typeof raw.title === "string" ? raw.title : "Artifact",
    filename: typeof raw.filename === "string" ? raw.filename : "artifact",
    kind: typeof raw.kind === "string" ? raw.kind : "html",
    status:
      outcome.status === "running" || outcome.status === "completed"
        ? outcome.status
        : undefined,
    blocksDone:
      typeof raw.blocks_done === "number" ? raw.blocks_done : undefined,
    blocksTotal:
      typeof raw.blocks_total === "number" ? raw.blocks_total : undefined,
    documentId:
      typeof raw.document_id === "string" ? raw.document_id : undefined,
    totalChars:
      typeof raw.total_chars === "number" ? raw.total_chars : undefined,
    error:
      outcome.ok === false
        ? outcome.error.message
        : typeof raw.error === "string"
          ? raw.error
          : undefined,
  };
}

/**
 * Renders the live HTML-artifact task card directly from the streaming
 * `tool-write_html` output (preliminary → terminal). Progress rides the main
 * useChat stream (ADR-0035); there is no separate task SSE subscription.
 */
export function ArtifactTaskCard({
  task,
  documents,
  onOpen,
}: {
  task: ArtifactTaskOutput;
  documents: Map<string, ConversationDocument>;
  onOpen: (documentId: string) => void;
}) {
  const status = task.status ?? "queued";

  if (status === "completed" && task.documentId) {
    return (
      <ArtifactDocumentCard
        document={documents.get(task.documentId)}
        documentId={task.documentId}
        fallback={{
          documentId: task.documentId,
          status: "persisted",
          title: task.title,
          filename: task.filename,
          kind: task.kind,
          totalChars: task.totalChars ?? undefined,
        }}
        onOpen={() => onOpen(task.documentId!)}
      />
    );
  }

  if (status === "failed" || status === "cancelled") {
    return (
      <Artifact>
        <ArtifactHeader>
          <div className="min-w-0">
            <ArtifactTitle className="truncate">{task.title}</ArtifactTitle>
            <ArtifactDescription className="truncate">
              {task.kind} · {task.filename} ·{" "}
              {status === "cancelled" ? "已取消" : "生成失败"}
            </ArtifactDescription>
          </div>
        </ArtifactHeader>
        {status === "failed" && task.error ? (
          <ArtifactContent className="px-4 py-3 text-xs text-destructive">
            {task.error}
          </ArtifactContent>
        ) : null}
      </Artifact>
    );
  }

  const done = task.blocksDone ?? 0;
  const total = task.blocksTotal ?? 0;
  const hasBlockProgress = total > 0;
  return (
    <Artifact>
      <ArtifactHeader>
        <div className="min-w-0">
          <ArtifactTitle className="truncate">{task.title}</ArtifactTitle>
          <ArtifactDescription className="truncate">
            {[task.kind, task.filename].filter(Boolean).join(" · ")}
          </ArtifactDescription>
        </div>
        <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
      </ArtifactHeader>
      <ArtifactContent className="flex-none px-4 py-3 text-xs text-muted-foreground">
        <FileTextIcon className="mr-1 inline size-3" />
        后台生成中
        {hasBlockProgress ? ` · 已生成 ${done}/${total} 页` : ""}
      </ArtifactContent>
    </Artifact>
  );
}

export function ArtifactDocumentCard({
  document,
  documentId,
  fallback,
  planExecuted,
  planBusy,
  onOpen,
  onExecutePlan,
}: {
  document: ConversationDocument | undefined;
  documentId: string;
  fallback?: ArtifactOutput;
  planExecuted?: boolean;
  planBusy?: boolean;
  onOpen: () => void;
  onExecutePlan?: () => void;
}) {
  const isPlan = fallback?.kind === "plan";
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
          {isPlan ? "编辑" : "预览"}
        </Button>
        {isPlan ? (
          <Button
            type="button"
            size="sm"
            disabled={planBusy}
            onClick={onExecutePlan}
          >
            {planExecuted ? "再次执行" : "立即执行"}
          </Button>
        ) : null}
      </ArtifactHeader>
      <ArtifactContent className="px-4 py-3 text-xs text-muted-foreground">
        <FileTextIcon className="mr-1 inline size-3" />
        AI artifact
      </ArtifactContent>
    </Artifact>
  );
}

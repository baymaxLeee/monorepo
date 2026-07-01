import { fetchConversationTask, type ConversationDocument, type Task } from "api";
import { Button } from "components";
import {
  Artifact,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "components/ai-chat";
import { FileTextIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";

// Synchronous tool result shape — only the markdown path returns this
// immediately (a single fast streamText call needs no durability). The HTML
// path always returns ArtifactTaskOutput instead (see below).
export type ArtifactOutput = {
  documentId: string;
  status: string;
  title: string;
  filename: string;
  kind: string;
  totalChars?: number;
};

export function parseArtifactOutput(output: unknown): ArtifactOutput | null {
  if (!output || typeof output !== "object") return null;
  const raw = output as Record<string, unknown>;
  if (typeof raw.document_id !== "string") return null;
  return {
    documentId: raw.document_id,
    status: typeof raw.status === "string" ? raw.status : "persisted",
    title: typeof raw.title === "string" ? raw.title : "Artifact",
    filename: typeof raw.filename === "string" ? raw.filename : "artifact",
    kind: typeof raw.kind === "string" ? raw.kind : "file",
    totalChars: typeof raw.total_chars === "number" ? raw.total_chars : undefined,
  };
}

// write_file/edit_file's HTML branch dispatches to executor and returns this
// immediately (status is "queued" or "running" at that point; the tool part
// itself never updates after that — ArtifactTaskCard below polls the task
// separately to find out when it actually finishes).
export type ArtifactTaskOutput = {
  taskId: string;
  title: string;
  filename: string;
  kind: string;
};

export function parseArtifactTaskOutput(output: unknown): ArtifactTaskOutput | null {
  if (!output || typeof output !== "object") return null;
  const raw = output as Record<string, unknown>;
  if (typeof raw.task_id !== "string") return null;
  return {
    taskId: raw.task_id,
    title: typeof raw.title === "string" ? raw.title : "Artifact",
    filename: typeof raw.filename === "string" ? raw.filename : "artifact",
    kind: typeof raw.kind === "string" ? raw.kind : "html",
  };
}

type HtmlArtifactTaskResult = {
  documentId?: string;
  totalChars?: number;
  blocksTotal?: number;
  blocksDone?: number;
  blocksFailed?: number;
};

function parseTaskResult(result: unknown): HtmlArtifactTaskResult {
  if (!result || typeof result !== "object") return {};
  const raw = result as Record<string, unknown>;
  return {
    documentId: typeof raw.documentId === "string" ? raw.documentId : undefined,
    totalChars: typeof raw.totalChars === "number" ? raw.totalChars : undefined,
    blocksTotal: typeof raw.blocksTotal === "number" ? raw.blocksTotal : undefined,
    blocksDone: typeof raw.blocksDone === "number" ? raw.blocksDone : undefined,
    blocksFailed: typeof raw.blocksFailed === "number" ? raw.blocksFailed : undefined,
  };
}

const POLL_MS = 2_000;

// Owns the full lifecycle of one background html-artifact task: polls
// chat's task proxy (-> executor) until the task leaves queued/running, then
// renders either the finished ArtifactDocumentCard or an error state. This
// replaces the old conversation-wide ArtifactJobBar poll — each card tracks
// only the one task it cares about, matching the non-blocking dispatch model
// (agent_task_执行时服务 plan Phase 2).
export function ArtifactTaskCard({
  task,
  conversationId,
  documents,
  onOpen,
}: {
  task: ArtifactTaskOutput;
  conversationId: string;
  documents: Map<string, ConversationDocument>;
  onOpen: (documentId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<Task | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    async function poll() {
      try {
        const next = await fetchConversationTask(conversationId, task.taskId);
        if (!active) return;
        setSnapshot(next);
        if (next.status === "queued" || next.status === "running") {
          timer = window.setTimeout(poll, POLL_MS);
        }
      } catch {
        if (active) timer = window.setTimeout(poll, POLL_MS * 2);
      }
    }
    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [conversationId, task.taskId]);

  const status = snapshot?.status ?? "queued";
  const result = parseTaskResult(snapshot?.result);

  if (status === "completed" && result.documentId) {
    return (
      <ArtifactDocumentCard
        document={documents.get(result.documentId)}
        documentId={result.documentId}
        fallback={{
          documentId: result.documentId,
          status: "persisted",
          title: task.title,
          filename: task.filename,
          kind: task.kind,
          totalChars: result.totalChars,
        }}
        blocksFailed={result.blocksFailed}
        onOpen={() => onOpen(result.documentId!)}
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
        {status === "failed" && snapshot?.error ? (
          <ArtifactContent className="px-4 py-3 text-xs text-destructive">
            {snapshot.error}
          </ArtifactContent>
        ) : null}
      </Artifact>
    );
  }

  const hasBlockProgress = typeof result.blocksTotal === "number" && result.blocksTotal > 0;
  return (
    <Artifact>
      <ArtifactHeader>
        <div className="min-w-0">
          <ArtifactTitle className="truncate">{task.title}</ArtifactTitle>
          <ArtifactDescription className="truncate">
            {task.kind} · {task.filename} · 后台生成中
            {hasBlockProgress ? ` · 已生成 ${result.blocksDone ?? 0}/${result.blocksTotal} 页` : ""}
          </ArtifactDescription>
        </div>
        <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
      </ArtifactHeader>
    </Artifact>
  );
}

export function ArtifactDocumentCard({
  document,
  documentId,
  fallback,
  blocksFailed,
  onOpen,
  onContinuePlan,
  onExecutePlan,
}: {
  document: ConversationDocument | undefined;
  documentId: string;
  fallback?: ArtifactOutput;
  blocksFailed?: number;
  onOpen: () => void;
  onContinuePlan?: () => void;
  onExecutePlan?: () => void;
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
        {fallback?.kind === "plan" ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onContinuePlan}
            >
              继续完善
            </Button>
            <Button type="button" size="sm" onClick={onExecutePlan}>
              开始执行
            </Button>
          </>
        ) : null}
      </ArtifactHeader>
      <ArtifactContent className="px-4 py-3 text-xs text-muted-foreground">
        <FileTextIcon className="mr-1 inline size-3" />
        AI artifact
        {blocksFailed ? (
          <span className="ml-2 text-destructive">
            · {blocksFailed} 页生成失败，已在预览中标注
          </span>
        ) : null}
      </ArtifactContent>
    </Artifact>
  );
}

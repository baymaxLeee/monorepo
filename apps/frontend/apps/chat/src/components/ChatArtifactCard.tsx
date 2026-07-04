import {
  parseJsonEventStream,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
  uiMessageChunkSchema,
} from "ai";
import {
  type ConversationDocument,
  openConversationTaskStream,
  type TaskStatus,
} from "api";
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
  documentId?: string;
  totalChars?: number;
  blocksFailed?: number;
  error?: string;
};

const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

function isTerminalTaskStatus(status: TaskStatus | undefined): boolean {
  return status !== undefined && TERMINAL_TASK_STATUSES.has(status);
}

export function parseArtifactTaskOutput(
  output: unknown,
): ArtifactTaskOutput | null {
  if (!output || typeof output !== "object") return null;
  const raw = output as Record<string, unknown>;
  if (typeof raw.task_id !== "string") return null;
  return {
    taskId: raw.task_id,
    title: typeof raw.title === "string" ? raw.title : "Artifact",
    filename: typeof raw.filename === "string" ? raw.filename : "artifact",
    kind: typeof raw.kind === "string" ? raw.kind : "html",
    status:
      typeof raw.status === "string" ? (raw.status as TaskStatus) : undefined,
    documentId:
      typeof raw.document_id === "string" ? raw.document_id : undefined,
    totalChars:
      typeof raw.total_chars === "number" ? raw.total_chars : undefined,
    blocksFailed:
      typeof raw.blocks_failed === "number" ? raw.blocks_failed : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

type ProgressSnapshot = {
  status: TaskStatus;
  progress: { done: number; total: number } | null;
  documentId: string | null;
  totalChars: number | null;
  blocksTotal: number | null;
  blocksDone: number | null;
  blocksFailed: number | null;
  error: string | null;
};

type JsonEventResult<T> = { success: true; value: T } | { success: false };

function latestProgress(message: UIMessage): ProgressSnapshot | null {
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    const part = message.parts[i];
    if (part && part.type === "data-artifact-progress" && "data" in part) {
      return part.data as ProgressSnapshot;
    }
  }
  return null;
}

function terminalSnapshot(task: ArtifactTaskOutput): ProgressSnapshot | null {
  if (!isTerminalTaskStatus(task.status)) return null;
  return {
    status: task.status as TaskStatus,
    progress: null,
    documentId: task.documentId ?? null,
    totalChars: task.totalChars ?? null,
    blocksTotal: null,
    blocksDone: null,
    blocksFailed: task.blocksFailed ?? null,
    error: task.error ?? null,
  };
}

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
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(() =>
    terminalSnapshot(task),
  );

  useEffect(() => {
    if (isTerminalTaskStatus(task.status)) return;
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const response = await openConversationTaskStream(
          conversationId,
          task.taskId,
          controller.signal,
        );
        const chunks = parseJsonEventStream({
          stream: response.body!,
          schema: uiMessageChunkSchema,
        }).pipeThrough(
          new TransformStream<JsonEventResult<UIMessageChunk>, UIMessageChunk>({
            transform(part, ctrl) {
              if (part.success) ctrl.enqueue(part.value);
            },
          }),
        );
        for await (const message of readUIMessageStream({ stream: chunks })) {
          if (!active) break;
          const data = latestProgress(message);
          if (data) setSnapshot(data);
        }
      } catch {}
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [conversationId, task.taskId, task.status]);

  const status = snapshot?.status ?? "queued";

  if (status === "completed" && snapshot?.documentId) {
    return (
      <ArtifactDocumentCard
        document={documents.get(snapshot.documentId)}
        documentId={snapshot.documentId}
        fallback={{
          documentId: snapshot.documentId,
          status: "persisted",
          title: task.title,
          filename: task.filename,
          kind: task.kind,
          totalChars: snapshot.totalChars ?? undefined,
        }}
        blocksFailed={snapshot.blocksFailed ?? undefined}
        onOpen={() => onOpen(snapshot.documentId!)}
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

  const done = snapshot?.progress?.done ?? snapshot?.blocksDone ?? 0;
  const total = snapshot?.progress?.total ?? snapshot?.blocksTotal ?? 0;
  const hasBlockProgress = total > 0;
  return (
    <Artifact>
      <ArtifactHeader>
        <div className="min-w-0">
          <ArtifactTitle className="truncate">{task.title}</ArtifactTitle>
          <ArtifactDescription className="truncate">
            {task.kind} · {task.filename} · 后台生成中
            {hasBlockProgress ? ` · 已生成 ${done}/${total} 页` : ""}
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

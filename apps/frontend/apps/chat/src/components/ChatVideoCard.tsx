import { Loader2Icon, PlaySquareIcon } from "lucide-react";
import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";
import { useChatStore } from "../store/useChatStore";
import { ChatMediaCard } from "./ChatMediaCard";

export type CreateVideoProductionOutput = {
  ok: boolean;
  status: string;
  prompt?: string;
  documentId?: string;
  productionId?: string;
  productionStage?: string;
  awaitingAction?: string;
  error?: string;
};

export function parseCreateVideoProductionOutput(
  output: unknown,
): CreateVideoProductionOutput | null {
  if (!output || typeof output !== "object") return null;
  const outcome = parseToolOutcome(output);
  if (!outcome) return null;
  const payload = toolOutcomePayload(outcome);
  const raw =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  return {
    ok: outcome.ok,
    status:
      outcome.status === "partial"
        ? "partial"
        : typeof raw.status === "string"
          ? raw.status
          : outcome.status,
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    documentId:
      typeof raw.document_id === "string" ? raw.document_id : undefined,
    productionId:
      typeof raw.production_id === "string" ? raw.production_id : undefined,
    productionStage:
      typeof raw.production_stage === "string"
        ? raw.production_stage
        : undefined,
    awaitingAction:
      typeof raw.awaiting_action === "string" ? raw.awaiting_action : undefined,
    error: outcome.ok === false ? outcome.error.message : undefined,
  };
}

export function ChatVideoCard({
  output,
  state,
  errorText,
  onOpen,
  conversationId,
}: {
  output: unknown;
  state: string;
  errorText?: string;
  onOpen: (documentId: string) => void;
  conversationId: string;
}) {
  const parsed = parseCreateVideoProductionOutput(output);
  const failed = state === "output-error" || parsed?.ok === false;
  const documentId = parsed?.documentId ?? null;
  const completed = parsed?.status === "completed" && Boolean(documentId);
  const openVideoProductionWorkspace = useChatStore(
    (store) => store.openVideoProductionWorkspace,
  );

  if (failed) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
        {errorText?.trim() || parsed?.error?.trim() || "视频制片任务创建失败。"}
      </div>
    );
  }

  if (completed && documentId) {
    return (
      <ChatMediaCard
        icon={PlaySquareIcon}
        title="视频"
        description="点击在侧栏预览"
        onOpen={() => onOpen(documentId)}
      />
    );
  }

  if (parsed?.productionId) {
    return (
      <ChatMediaCard
        icon={PlaySquareIcon}
        title="视频制片任务"
        description={
          parsed.awaitingAction
            ? "制片任务已创建，打开导演工作台完成审批"
            : "制片任务已创建，后台工作流正在持续推进"
        }
        onOpen={() =>
          openVideoProductionWorkspace(conversationId, parsed.productionId!)
        }
      />
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 shrink-0 animate-spin" />
      <span className="truncate">
        {parsed?.prompt
          ? `正在创建视频制片任务，规划初步分镜与预算：${parsed.prompt}`
          : "正在创建视频制片任务，规划初步分镜与预算…"}
      </span>
    </div>
  );
}

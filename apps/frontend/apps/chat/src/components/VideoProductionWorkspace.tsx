import { MessageResponse } from "@repo/ai-elements";
import {
  decideVideoProduction,
  fetchVideoProduction,
  fetchVideoProductionPreview,
  type VideoProductionDetail,
  type VideoShotPlan,
} from "@repo/api";
import { Badge, Button, ScrollArea, Separator, toast } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { Loader2Icon, RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { VideoApprovalFooter } from "./VideoApprovalFooter";
import { VideoStoryboardEditor } from "./VideoStoryboardEditor";
import { VideoTakeReview } from "./VideoTakeReview";

const STAGE_LABELS: Record<string, string> = {
  planning: "策划中",
  awaiting_storyboard_approval: "分镜待审批",
  generating: "镜头生成中",
  shot_review: "镜头待审核",
  assembling: "合成中",
  final_qa: "最终质检",
  awaiting_publish_approval: "成片待发布",
  publishing: "发布中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const ACTIVE_STAGES = new Set(["planning", "generating", "assembling", "final_qa", "publishing"]);

function formatCost(micros: number | null | undefined, currency: string | null) {
  if (micros == null) {
    return "—";
  }
  return `${currency ?? ""} ${(micros / 1_000_000).toFixed(2)}`.trim();
}

export function VideoProductionWorkspace({
  conversationId,
  productionId,
  onClose,
}: {
  conversationId: string;
  productionId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<VideoProductionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await fetchVideoProduction(conversationId, productionId));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [conversationId, productionId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!detail?.production.stagedMediaId) {
      setPreviewUrl(null);
      return;
    }
    let active = true;
    let url: string | null = null;
    void fetchVideoProductionPreview(conversationId, productionId)
      .then((blob) => {
        if (!active) {
          return;
        }
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      })
      .catch(() => setPreviewUrl(null));
    return () => {
      active = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [conversationId, detail?.production.stagedMediaId, productionId]);

  async function submitDecision(decision: Parameters<typeof decideVideoProduction>[2]) {
    setDeciding(true);
    try {
      await decideVideoProduction(conversationId, productionId, decision);
      await load();
    } finally {
      setDeciding(false);
    }
  }

  async function saveStoryboard(shotPlan: VideoShotPlan) {
    const production = detail?.production;
    if (!production) {
      return;
    }
    try {
      await submitDecision({
        action: "revise_storyboard",
        action_id: crypto.randomUUID(),
        expected_version: production.version,
        shot_plan: shotPlan,
      });
      toast.success("已保存新分镜版本，旧审批已失效");
    } catch (error) {
      toast.error(getErrorMessage(error, "保存分镜失败"));
    }
  }

  async function retryTake(shotId: string) {
    const production = detail?.production;
    if (!production) {
      return;
    }
    try {
      await submitDecision({
        action: "request_take",
        action_id: crypto.randomUUID(),
        expected_version: production.version,
        shot_id: shotId,
      });
    } catch (error) {
      toast.error(getErrorMessage(error, "重拍失败"));
    }
  }

  async function approveTakes(selections: Array<{ shotId: string; takeId: string }>) {
    const production = detail?.production;
    if (!production) {
      return;
    }
    try {
      await submitDecision({
        action: "approve_takes",
        action_id: crypto.randomUUID(),
        expected_version: production.version,
        selections: selections.map((selection) => ({
          shot_id: selection.shotId,
          take_id: selection.takeId,
        })),
      });
    } catch (error) {
      toast.error(getErrorMessage(error, "Take 审批失败"));
    }
  }

  async function decide(approved: boolean, input: { budgetLimitMicros?: number; waiverReason?: string }) {
    const production = detail?.production;
    if (!production?.awaitingAction) {
      return;
    }
    try {
      const common = {
        action_id: crypto.randomUUID(),
        expected_version: production.version,
      };
      if (production.awaitingAction === "storyboard_approval") {
        const estimate = production.cost.estimatedMicros;
        const currency = production.cost.currency;
        if (estimate == null || !currency) {
          throw new Error("缺少视频定价，无法审批");
        }
        const budgetLimitMicros = input.budgetLimitMicros;
        if (approved && (budgetLimitMicros == null || budgetLimitMicros < estimate)) {
          throw new Error("预算上限不能低于预计成本");
        }
        await submitDecision(
          approved
            ? {
                action: "approve_storyboard",
                ...common,
                budget_limit_micros: budgetLimitMicros!,
                currency,
              }
            : {
                action: "reject_storyboard",
                ...common,
                reason: "导演工作台拒绝分镜",
              },
        );
      } else {
        const reason = input.waiverReason;
        await submitDecision(
          approved
            ? {
                action: "approve_publish",
                ...common,
                ...(reason ? { waiver_reason: reason } : {}),
              }
            : {
                action: "reject_publish",
                ...common,
                reason: "导演工作台拒绝发布",
              },
        );
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "审批失败"));
    }
  }

  const production = detail?.production;
  const isActive = production ? ACTIVE_STAGES.has(production.stage) : false;
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{production?.title ?? "视频制片"}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isActive ? <Loader2Icon className="size-3 animate-spin" /> : null}
            {production ? (STAGE_LABELS[production.stage] ?? production.stage) : "加载中"}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="刷新" onClick={() => void load()}>
          <RefreshCwIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        {loading && !production ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2Icon className="size-5 animate-spin" />
          </div>
        ) : production ? (
          <div className="space-y-5 p-4">
            {isActive ? (
              <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                后台制片工作流仍在运行；聊天 SSE 结束或关闭页面不会中断任务。
              </p>
            ) : null}
            <section className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">预计成本</p>
                <p className="mt-1 font-medium">
                  {formatCost(production.cost.estimatedMicros, production.cost.currency)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">已核销</p>
                <p className="mt-1 font-medium">
                  {formatCost(production.cost.reconciledMicros, production.cost.currency)}
                </p>
              </div>
            </section>

            {previewUrl ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">成片预览</h3>
                {/* biome-ignore lint/a11y/useMediaCaption: generated previews do not have a VTT artifact yet */}
                <video className="w-full rounded-lg border bg-black" controls src={previewUrl} />
              </section>
            ) : null}

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">镜头清单</h3>
                <Badge variant="secondary">v{production.shotPlan?.version ?? 0}</Badge>
              </div>
              {production.awaitingAction === "storyboard_approval" && production.shotPlan ? (
                <VideoStoryboardEditor plan={production.shotPlan} disabled={deciding} onSave={saveStoryboard} />
              ) : (
                production.shotPlan?.shots.map((shot) => (
                  <article key={shot.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span>镜头 {shot.order + 1}</span>
                      <span className="text-muted-foreground">
                        {shot.seconds}s · {shot.camera.shotSize}
                      </span>
                    </div>
                    <MessageResponse className="text-sm">{shot.narrativeBeat}</MessageResponse>
                    <p className="text-xs text-muted-foreground">{shot.action}</p>
                  </article>
                ))
              )}
            </section>

            {production.awaitingAction === "shot_review" && production.shotPlan ? (
              <VideoTakeReview
                conversationId={conversationId}
                productionId={productionId}
                shots={production.shotPlan.shots}
                reviews={production.shotReviews}
                disabled={deciding}
                onRetry={retryTake}
                onApprove={approveTakes}
              />
            ) : null}

            {production.qaReport ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">质量门</h3>
                <pre className="overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
                  {JSON.stringify(production.qaReport, null, 2)}
                </pre>
              </section>
            ) : null}

            {production.error ? (
              <p className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{production.error}</p>
            ) : null}
            <Separator />
            <section className="space-y-2">
              <h3 className="text-sm font-medium">事件记录</h3>
              {detail?.events
                .slice()
                .reverse()
                .map((event) => (
                  <div key={String(event.sequence)} className="flex gap-2 text-xs">
                    <span className="text-muted-foreground">#{String(event.sequence ?? "–")}</span>
                    <span>{String(event.kind ?? "event")}</span>
                  </div>
                ))}
            </section>
          </div>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            {loadFailed ? "无法加载制片记录。" : "制片记录不存在。"}
          </div>
        )}
      </ScrollArea>
      {production?.awaitingAction && production.awaitingAction !== "shot_review" ? (
        <VideoApprovalFooter production={production} disabled={deciding} onDecision={decide} />
      ) : null}
    </div>
  );
}

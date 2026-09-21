import {
  canvasProjectManagement,
  canvasProjectProviders,
  canvasProjectUsage,
  canvasProjectUsageWorkbook,
  canvasUpdateProjectUsageLimit,
  listWorkspaceMembers,
  type CanvasProjectManagement,
  type CanvasProjectUsage,
  type CanvasProjectProvider,
  type WorkspaceMemberView,
} from "@repo/api";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, toast } from "@repo/design-system";
import { useEffect, useState } from "react";

import { MembersForm } from "./MembersForm";
import { ModelsForm } from "./ModelsForm";

export function ProjectDetails({
  projectId,
  workspaceId,
  canManageMembers,
}: {
  projectId: string;
  workspaceId: string;
  canManageMembers: boolean;
}) {
  const [details, setDetails] = useState<CanvasProjectManagement | null>(null);
  const [usage, setUsage] = useState<CanvasProjectUsage | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberView[]>([]);
  const [providers, setProviders] = useState<CanvasProjectProvider[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [usageLimit, setUsageLimit] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);
  useEffect(() => {
    let active = true;
    setDetails(null);
    setFailed(false);
    void canvasProjectManagement(projectId)
      .then(async (value) => {
        const [models, directory, stats] = await Promise.all([
          canvasProjectProviders(projectId),
          canManageMembers ? listWorkspaceMembers(workspaceId, "active") : Promise.resolve([]),
          value.can_manage ? canvasProjectUsage(projectId) : Promise.resolve(null),
        ]);
        if (active) {
          setDetails(value);
          setMembers(directory);
          setProviders(models.items);
          setUsage(stats);
          setUsageLimit(value.usage_limit_micros === null ? "" : String(value.usage_limit_micros / 1_000_000));
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [projectId, workspaceId, canManageMembers, attempt]);
  async function download() {
    setDownloading(true);
    try {
      const blob = await canvasProjectUsageWorkbook(projectId, { responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${details?.project.name ?? "项目"}-用量明细.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* Request errors are presented by the API client. */
    } finally {
      setDownloading(false);
    }
  }
  async function saveUsageLimit() {
    const yuan = usageLimit.trim() === "" ? null : Number(usageLimit);
    if (yuan !== null && (!Number.isFinite(yuan) || yuan <= 0 || yuan > 1_000_000_000)) {
      toast.error("项目用量限额应大于 0 且不超过 10 亿元");
      return;
    }
    setSavingLimit(true);
    try {
      const next = await canvasUpdateProjectUsageLimit(projectId, {
        expected_revision: details?.project.revision ?? 0,
        usage_limit_micros: yuan === null ? null : Math.round(yuan * 1_000_000),
      });
      setDetails(next);
      toast.success("项目额度已保存");
    } finally {
      setSavingLimit(false);
    }
  }
  if (failed) return <Button onClick={() => setAttempt((value) => value + 1)}>加载失败，重试</Button>;
  if (!details) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      <MembersForm
        key={`members:${details.project.revision}`}
        details={details}
        directory={members}
        editable={canManageMembers && details.can_manage}
        onSaved={setDetails}
      />
      <ModelsForm
        key={`models:${details.project.revision}`}
        details={details}
        providers={providers}
        onSaved={setDetails}
      />
      {usage ? (
        <Card>
          <CardHeader>
            <CardTitle>项目用量</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              共 {usage.total} 次生成 · 成功 {usage.completed} · 失败 {usage.failed} · 已取消 {usage.cancelled} · 进行中{" "}
              {usage.active}
            </p>
            <p className="text-sm text-muted-foreground">
              配置估算用量：{(details.used_amount_micros / 1_000_000).toFixed(2)} {details.currency || "CNY"}
            </p>
            {details.can_manage ? (
              <div className="flex max-w-md items-end gap-3">
                <label className="grid flex-1 gap-2 text-sm">
                  项目总金额限额（元，留空表示不限制）
                  <Input
                    type="number"
                    min={0.000001}
                    max={1_000_000_000}
                    step={0.01}
                    value={usageLimit}
                    onChange={(event) => setUsageLimit(event.target.value)}
                  />
                </label>
                <Button disabled={savingLimit} onClick={() => void saveUsageLimit()}>
                  保存额度
                </Button>
              </div>
            ) : null}
            <Button variant="outline" disabled={downloading} onClick={() => void download()}>
              {downloading ? "正在导出…" : "下载用量明细 XLSX"}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

import {
  canvasAdminGetProject,
  canvasAdminUpdateProject,
  canvasDownloadProjectUsage,
  listWorkspaceMembers,
  type CanvasProjectDetail,
  type WorkspaceMemberView,
} from "@repo/api";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, toast } from "@repo/design-system";
import { useEffect, useState } from "react";

import { MembersForm } from "./MembersForm";

export function ProjectDetails({
  projectId,
  workspaceId,
  canManageMembers,
}: {
  projectId: string;
  workspaceId: string;
  canManageMembers: boolean;
}) {
  const [project, setProject] = useState<CanvasProjectDetail | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberView[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [usageLimit, setUsageLimit] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);
  useEffect(() => {
    let active = true;
    setProject(null);
    setFailed(false);
    void Promise.all([canvasAdminGetProject(projectId), listWorkspaceMembers(workspaceId, "active")])
      .then(([response, directory]) => {
        if (!active) return;
        setProject(response.project);
        setMembers(directory);
        setUsageLimit(response.project.usage_limit === undefined ? "" : String(response.project.usage_limit));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [projectId, workspaceId, attempt]);

  async function download() {
    setDownloading(true);
    try {
      const result = await canvasDownloadProjectUsage(projectId);
      const link = document.createElement("a");
      link.href = result.download_url;
      link.download = result.file_name;
      link.click();
    } finally {
      setDownloading(false);
    }
  }

  async function saveUsageLimit() {
    if (!project) return;
    const yuan = usageLimit.trim() === "" ? undefined : Number(usageLimit);
    if (yuan !== undefined && (!Number.isInteger(yuan) || yuan <= 0 || yuan > 1_000_000_000)) {
      toast.add({ type: "error", title: "项目用量限额应为正整数且不超过 10 亿元" });
      return;
    }
    setSavingLimit(true);
    try {
      const response = await canvasAdminUpdateProject(projectId, {
        name: project.name,
        member_user_ids: project.member_user_ids,
        usage_limit: yuan,
        cover_image_path: project.cover_image_path,
      });
      setProject(response.project);
      toast.add({ type: "success", title: "项目额度已保存" });
    } finally {
      setSavingLimit(false);
    }
  }

  if (failed) return <Button onClick={() => setAttempt((value) => value + 1)}>加载失败，重试</Button>;
  if (!project) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      <MembersForm
        key={`members:${project.updated_at}`}
        project={project}
        directory={members}
        editable={canManageMembers}
        onSaved={setProject}
      />
      <Card>
        <CardHeader>
          <CardTitle>项目用量</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">当前已用金额：{(project.used_amount ?? 0).toFixed(2)} 元</p>
          {canManageMembers ? (
            <div className="flex max-w-md items-end gap-3">
              <label className="grid flex-1 gap-2 text-sm">
                项目总金额限额（元，留空表示不限制）
                <Input
                  type="number"
                  min={1}
                  max={1_000_000_000}
                  step={1}
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
    </div>
  );
}

import {
  canvasDeleteProject,
  canvasListProjects,
  canvasProjectManagement,
  type CanvasProject,
  type CanvasProjectManagement,
} from "@repo/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Page,
  PageHeader,
  PageTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@repo/design-system";
import { useEffect, useState } from "react";

import { useAdminIdentity } from "../../identity";
import { ProjectDetails } from "./ProjectDetails";
import { ProjectDialog } from "./ProjectDialog";

export function Component() {
  const { activeWorkspaceId, isWorkspaceAdmin } = useAdminIdentity();
  const [projects, setProjects] = useState<CanvasProject[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<CanvasProjectManagement | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<CanvasProject | null>(null);
  useEffect(() => {
    let active = true;
    setProjects(null);
    setProjectId("");
    setFailed(false);
    void canvasListProjects()
      .then((result) => {
        if (active) {
          setProjects(result.items);
          setProjectId(result.items[0]?.id ?? "");
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [activeWorkspaceId, attempt]);
  return (
    <Page>
      <PageHeader>
        <PageTitle>创作项目管理</PageTitle>
        {isWorkspaceAdmin ? <Button onClick={() => setDialog(null)}>创建项目</Button> : null}
      </PageHeader>
      {failed ? (
        <Button onClick={() => setAttempt((value) => value + 1)}>加载失败，重试</Button>
      ) : !projects ? (
        <Skeleton className="h-40" />
      ) : projects.length === 0 ? (
        <p className="text-muted-foreground">当前工作空间暂无创作项目。</p>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-80">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isWorkspaceAdmin ? (
              <>
                <Button variant="outline" onClick={() => void canvasProjectManagement(projectId).then(setDialog)}>
                  编辑项目
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setDeleting(projects.find((item) => item.id === projectId) ?? null)}
                >
                  删除项目
                </Button>
              </>
            ) : null}
          </div>
          <ProjectDetails
            key={`${activeWorkspaceId}:${projectId}`}
            projectId={projectId}
            workspaceId={activeWorkspaceId ?? ""}
            canManageMembers={isWorkspaceAdmin}
          />
        </div>
      )}
      <ProjectDialog
        key={dialog === undefined ? "closed" : (dialog?.project.id ?? "create")}
        value={dialog}
        workspaceId={activeWorkspaceId ?? ""}
        onClose={() => setDialog(undefined)}
        onSaved={() => setAttempt((value) => value + 1)}
      />
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目？</AlertDialogTitle>
            <AlertDialogDescription>删除后项目及其画布将不可访问，请谨慎操作。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleting) return;
                void canvasDeleteProject(deleting.id, { expected_revision: deleting.revision }).then(() => {
                  setDeleting(null);
                  setAttempt((value) => value + 1);
                });
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

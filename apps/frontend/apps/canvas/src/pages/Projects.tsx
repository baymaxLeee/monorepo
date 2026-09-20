import {
  canvasCreateBoard,
  canvasCreateProject,
  canvasListBoards,
  canvasListProjects,
  canvasGetProject,
  canvasUpdateProject,
  canvasUpdateBoard,
  canvasDeleteProject,
  canvasDeleteBoard,
  type CanvasBoard,
  type CanvasProject,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Page,
  PageHeader,
  PageTitle,
  Skeleton,
  TooltipProvider,
} from "@repo/design-system";
import { usePlatformStore } from "@repo/runtime";
import { ArrowDownUp, ArrowLeft, Clock, Film, MoreHorizontal, Plus, RefreshCw, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { NameDialog } from "../components/NameDialog";

type Item = CanvasProject | CanvasBoard;
export function Component() {
  const { projectId } = useParams();
  const [items, setItems] = useState<Item[]>([]);
  const [project, setProject] = useState<CanvasProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<Item | "create" | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [ascending, setAscending] = useState(false);
  const user = usePlatformStore((state) => state.user);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    const request = projectId ? canvasListBoards(projectId) : canvasListProjects();
    void Promise.all([request, projectId ? canvasGetProject(projectId) : Promise.resolve(null)])
      .then(([result, detail]) => {
        if (active) {
          setItems(result.items);
          setProject(detail);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, refresh]);
  const filtered = items
    .filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => (ascending ? 1 : -1) * a.updated_at.localeCompare(b.updated_at));
  const canManage = (item: Item) =>
    projectId || user?.activeOrg?.role === "org_admin" || ("created_by" in item && item.created_by === user?.id);
  return (
    <TooltipProvider>
      <Page>
        <PageHeader>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon">
              <Link to={projectId ? "/platform/canvas" : "/platform/chat"} aria-label="返回项目">
                <ArrowLeft />
              </Link>
            </Button>
            <PageTitle>{projectId ? (project?.name ?? "项目") : "我的项目"}</PageTitle>
          </div>
          <div className="flex items-center gap-2">
            {projectId ? (
              <Button asChild variant="outline">
                <Link to={`/platform/canvas/projects/${projectId}/resources`}>资产库</Link>
              </Button>
            ) : null}
            <Button asChild variant="ghost">
              <Link to="/platform/admin/canvas">
                <Settings className="size-4" />
                创作设置
              </Link>
            </Button>
            <Button onClick={() => setDialog("create")}>
              <Plus className="size-4" />
              {projectId ? "新建剧集" : "新建项目"}
            </Button>
          </div>
        </PageHeader>
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="font-medium">
            {projectId ? "视频创作" : "全部项目"} <span className="text-muted-foreground">{items.length}</span>
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="w-64 pl-9"
                aria-label="搜索名称"
                placeholder="输入名称搜索"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button variant="outline" onClick={() => setAscending(!ascending)}>
              <ArrowDownUp className="size-4" />
              更新时间{ascending ? "↑" : "↓"}
            </Button>
            <Button variant="ghost" size="icon" aria-label="刷新" onClick={() => setRefresh((value) => value + 1)}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : failed ? (
          <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>
            加载失败，重试
          </Button>
        ) : filtered.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((item) => (
              <article
                key={item.id}
                className="group relative overflow-hidden rounded-2xl border border-transparent p-1 transition-colors hover:border-foreground"
              >
                <Link
                  className="block"
                  to={
                    projectId
                      ? `/platform/canvas/projects/${projectId}/canvases/${item.id}`
                      : `/platform/canvas/projects/${item.id}`
                  }
                >
                  <div className="flex aspect-video items-center justify-center rounded-xl bg-muted">
                    <Film className="size-10 text-muted-foreground" />
                  </div>
                  <div className="space-y-2 px-3 py-4">
                    <h3 className="truncate text-lg font-medium">{item.name}</h3>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      <time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleString()}</time>
                    </p>
                    {"description" in item && item.description ? (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                    ) : null}
                  </div>
                </Link>
                {canManage(item) ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="absolute right-3 top-3"
                        aria-label={`${item.name}的更多操作`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDialog(item)}>编辑名称</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(item)}>
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-24 text-muted-foreground">
            <Film className="size-12" />
            <p>{query ? "没有匹配的结果" : projectId ? "暂无剧集，创建后开始创作" : "暂无项目"}</p>
            {!query ? (
              <Button onClick={() => setDialog("create")}>
                <Plus className="size-4" />
                {projectId ? "新建剧集" : "新建项目"}
              </Button>
            ) : null}
          </div>
        )}
        {dialog ? (
          <NameDialog
            key={dialog === "create" ? "create" : dialog.id}
            title={`${dialog === "create" ? "新建" : "编辑"}${projectId ? "剧集" : "项目"}`}
            initialName={dialog === "create" ? "" : dialog.name}
            open
            onClose={() => setDialog(null)}
            onSubmit={async (name) => {
              if (dialog === "create") {
                if (projectId) await canvasCreateBoard(projectId, { name });
                else await canvasCreateProject({ name, description: "" });
              } else if (projectId) await canvasUpdateBoard(dialog.id, { name, expected_revision: dialog.revision });
              else
                await canvasUpdateProject(dialog.id, {
                  name,
                  description: "description" in dialog ? dialog.description : "",
                  expected_revision: dialog.revision,
                });
              setRefresh((value) => value + 1);
            }}
          />
        ) : null}
        <AlertDialog
          open={Boolean(deleting)}
          onOpenChange={(open) => {
            if (!open && !busy) setDeleting(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除「{deleting?.name}」？</AlertDialogTitle>
              <AlertDialogDescription>删除后将不再显示在列表中，关联画布也无法继续访问。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  if (!deleting) return;
                  setBusy(true);
                  const request = projectId
                    ? canvasDeleteBoard(deleting.id, { expected_revision: deleting.revision })
                    : canvasDeleteProject(deleting.id, { expected_revision: deleting.revision });
                  void request
                    .then(() => {
                      setDeleting(null);
                      setRefresh((value) => value + 1);
                    })
                    .catch(() => setRefresh((value) => value + 1))
                    .finally(() => setBusy(false));
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Page>
    </TooltipProvider>
  );
}

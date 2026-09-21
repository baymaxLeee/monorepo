import {
  canvasListResources,
  canvasCreateResource,
  canvasUpdateResource,
  canvasDeleteResource,
  type CanvasResource,
} from "@repo/api";
import {
  Button,
  Input,
  ScrollArea,
  Skeleton,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@repo/design-system";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, UserRound, Mountain, Package, Music } from "lucide-react";
import { useEffect, useState } from "react";

import { NameDialog } from "./NameDialog";
import { ResourceAssets } from "./ResourceAssets";

const categories = [
  { type: 1, label: "角色", icon: UserRound },
  { type: 2, label: "场景", icon: Mountain },
  { type: 3, label: "道具", icon: Package },
  { type: 4, label: "音频", icon: Music },
];
export function ResourceLibrary({
  projectId,
  onCopy,
}: {
  projectId: string;
  onCopy?: (assetId: string) => Promise<void>;
}) {
  const [type, setType] = useState(1);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CanvasResource[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<CanvasResource | "create" | null>(null);
  const [deleting, setDeleting] = useState<CanvasResource | null>(null);
  useEffect(() => {
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener("canvas:resources-changed", refresh);
    return () => window.removeEventListener("canvas:resources-changed", refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void canvasListResources(projectId, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setItems(result.items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, reload]);
  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-16 shrink-0 flex-col gap-2 border-r p-2" aria-label="资产分类">
        {categories.map(({ type: value, label, icon: Icon }) => (
          <Button
            key={value}
            variant={type === value ? "secondary" : "ghost"}
            className="h-auto flex-col gap-1 py-3"
            onClick={() => setType(value)}
          >
            <Icon className="size-4" />
            <span className="text-xs">{label}</span>
          </Button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex gap-2 p-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入名称搜索"
            aria-label="搜索资产"
          />
          <Button size="icon" variant="outline" aria-label="新建资源" onClick={() => setDialog("create")}>
            <Plus />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {loading ? (
            <Skeleton className="m-3 h-24" />
          ) : failed ? (
            <Button variant="ghost" onClick={() => setReload((v) => v + 1)}>
              加载失败，重试
            </Button>
          ) : (
            items
              .filter((r) => r.type === type && r.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
              .map((resource) => (
                <div key={resource.id} className="border-b">
                  <div className="flex items-center gap-1 px-2 py-1">
                    <Button
                      className="min-w-0 flex-1 justify-start"
                      variant="ghost"
                      onClick={() => setExpanded(expanded === resource.id ? null : resource.id)}
                    >
                      {expanded === resource.id ? (
                        <ChevronDown className="size-3" />
                      ) : (
                        <ChevronRight className="size-3" />
                      )}
                      <span className="truncate">{resource.name}</span>
                      <span className="text-muted-foreground">· {resource.resource_asset_count}</span>
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="编辑资源" onClick={() => setDialog(resource)}>
                      <Pencil className="size-3" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="删除资源" onClick={() => setDeleting(resource)}>
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                  {expanded === resource.id ? (
                    <ResourceAssets
                      projectId={projectId}
                      resource={resource}
                      onChange={() => setReload((v) => v + 1)}
                      onCopy={onCopy}
                    />
                  ) : null}
                </div>
              ))
          )}
        </ScrollArea>
      </div>
      {dialog ? (
        <NameDialog
          key={dialog === "create" ? "create" : dialog.id}
          open
          title={dialog === "create" ? "新建资源" : "编辑资源"}
          initialName={dialog === "create" ? "" : dialog.name}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (dialog === "create")
              await canvasCreateResource(projectId, { name, type, description: "", expected_revision: 0 });
            else
              await canvasUpdateResource(projectId, dialog.id, {
                name,
                type: dialog.type,
                description: dialog.description,
                expected_revision: dialog.revision,
              });
            setDialog(null);
            setReload((v) => v + 1);
          }}
        />
      ) : null}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除资源？</AlertDialogTitle>
            <AlertDialogDescription>资源及其素材将从资源库移除，已经独立复制到画布的内容保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (!deleting) return;
                setBusy(true);
                void canvasDeleteResource(projectId, deleting.id, { expected_revision: deleting.revision })
                  .then(() => {
                    setDeleting(null);
                    setReload((v) => v + 1);
                  })
                  .catch(() => {})
                  .finally(() => setBusy(false));
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

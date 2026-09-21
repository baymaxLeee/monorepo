import { canvasCreateResource, canvasListResources, canvasUploadResourceAsset, type CanvasResource } from "@repo/api";
import { Button, Input, ScrollArea, Skeleton } from "@repo/design-system";
import { Box, Images, Mountain, Music, Package, Plus, RefreshCw, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CompactResources } from "./CompactResources";
import { ResourceCard } from "./ResourceCard";
import { ResourceLibraryDialogs } from "./ResourceLibraryDialogs";

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
  const compact = Boolean(onCopy);
  const [type, setType] = useState(1);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CanvasResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<CanvasResource | "create" | null>(null);
  const [managed, setManaged] = useState<CanvasResource | null>(null);
  const [deleting, setDeleting] = useState<CanvasResource | null>(null);
  const upload = useRef<HTMLInputElement>(null);

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
  useEffect(() => {
    if (!managed) return;
    const current = items.find((item) => item.id === managed.id);
    if (current && current.revision !== managed.revision) setManaged(current);
  }, [items, managed]);

  const visible = useMemo(
    () =>
      items.filter(
        (item) => item.type === type && item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    [items, query, type],
  );
  const refresh = () => setReload((value) => value + 1);
  const counts = new Map(
    categories.map((category) => [category.type, items.filter((item) => item.type === category.type).length]),
  );

  async function createFromFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    try {
      for (const file of files) {
        const resource = await canvasCreateResource(projectId, {
          name:
            Array.from(file.name.replace(/\.[^.]+$/u, ""))
              .slice(0, 50)
              .join("") || "未命名资产",
          type,
          description: "",
          expected_revision: 0,
        });
        await canvasUploadResourceAsset(projectId, resource.id, crypto.randomUUID(), file, { name: resource.name });
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden" aria-label="项目资产库">
      <div
        className={
          compact ? "space-y-2 border-b p-3" : "flex flex-wrap items-center justify-between gap-3 px-5 pb-6 pt-4"
        }
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {categories.map(({ type: value, label, icon: Icon }) => (
            <Button
              key={value}
              size={compact ? "sm" : "default"}
              variant={type === value ? "secondary" : "ghost"}
              onClick={() => setType(value)}
            >
              <Icon className="size-4" />
              {label}
              <span className="rounded-full bg-background px-1.5 text-[10px] text-muted-foreground">
                {counts.get(value)}
              </span>
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className={compact ? "pl-8" : "w-52 pl-8"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入资产名称搜索"
            />
          </div>
          {!compact ? (
            <>
              <Button variant="outline" onClick={() => upload.current?.click()} disabled={busy}>
                <Images className="size-4" />
                从本地上传
              </Button>
              <Button onClick={() => setDialog("create")} disabled={busy}>
                <Plus className="size-4" />
                创建资产
              </Button>
              <Button size="icon" variant="outline" onClick={refresh} aria-label="刷新资产库">
                <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
              </Button>
            </>
          ) : (
            <Button size="icon" variant="outline" onClick={() => setDialog("create")} aria-label="新建资产">
              <Plus />
            </Button>
          )}
        </div>
      </div>
      <input
        ref={upload}
        type="file"
        multiple
        className="hidden"
        accept={type === 4 ? "audio/*" : "image/*"}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void createFromFiles(files);
        }}
      />
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className={compact ? "space-y-3 p-3" : "grid grid-cols-2 gap-4 p-5 lg:grid-cols-4 xl:grid-cols-5"}>
            {Array.from({ length: compact ? 4 : 10 }, (_, index) => (
              <Skeleton className={compact ? "h-16" : "aspect-[4/3] rounded-2xl"} key={index} />
            ))}
          </div>
        ) : failed ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>资产加载失败，请稍后重试</p>
            <Button variant="outline" onClick={refresh}>
              重新加载
            </Button>
          </div>
        ) : visible.length ? (
          compact ? (
            <CompactResources items={visible} onManage={setManaged} onEdit={setDialog} onDelete={setDeleting} />
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-8 p-5 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map((resource) => (
                <ResourceCard
                  key={resource.id}
                  projectId={projectId}
                  resource={resource}
                  onManage={() => setManaged(resource)}
                  onEdit={() => setDialog(resource)}
                  onDelete={() => setDeleting(resource)}
                />
              ))}
            </div>
          )
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Box className="size-14 stroke-1" />
            <p className="text-base font-medium text-foreground">
              {query.trim() ? "没有找到相关资产" : `暂无${categories.find((item) => item.type === type)?.label}资产`}
            </p>
            <p className="text-sm">{query.trim() ? "请尝试其他关键词" : "从本地上传或创建空白资产"}</p>
          </div>
        )}
      </ScrollArea>
      <ResourceLibraryDialogs
        projectId={projectId}
        type={type}
        dialog={dialog}
        setDialog={setDialog}
        managed={managed}
        setManaged={setManaged}
        deleting={deleting}
        setDeleting={setDeleting}
        busy={busy}
        setBusy={setBusy}
        refresh={refresh}
        onCopy={onCopy}
      />
    </section>
  );
}

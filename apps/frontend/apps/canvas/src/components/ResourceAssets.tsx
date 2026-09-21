import {
  canvasCreateGeneratedResourceAsset,
  canvasListResourceAssets,
  canvasUploadResourceAsset,
  type CanvasResource,
  type CanvasResourceAsset,
} from "@repo/api";
import { Badge, Button, Input, ScrollArea, Skeleton } from "@repo/design-system";
import { ImagePlus, Images, Search, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ResourceAssetActions } from "./ResourceAssetActions";
import { ResourceGeneration } from "./ResourceGeneration";
import { ResourceMedia } from "./ResourceMedia";

export function ResourceAssets({
  projectId,
  resource,
  onChange,
  onCopy,
}: {
  projectId: string;
  resource: CanvasResource;
  onChange: () => void;
  onCopy?: (assetId: string) => Promise<void>;
}) {
  const [items, setItems] = useState<CanvasResourceAsset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void canvasListResourceAssets(projectId, resource.id, { signal: controller.signal })
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
  }, [projectId, resource.id, reload]);
  const visible = useMemo(
    () => items.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    [items, query],
  );
  const changed = () => {
    setReload((value) => value + 1);
    onChange();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入素材名称搜索"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={input}
            className="hidden"
            accept={resource.type === 4 ? "audio/*" : "image/*"}
            aria-label="上传资源素材"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setBusy(true);
              void canvasUploadResourceAsset(projectId, resource.id, crypto.randomUUID(), file, {
                name: Array.from(file.name.replace(/\.[^.]+$/u, ""))
                  .slice(0, 50)
                  .join(""),
              })
                .then(changed)
                .catch(() => {})
                .finally(() => setBusy(false));
            }}
          />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            <Images className="size-4" />
            {busy ? "处理中…" : "从本地上传"}
          </Button>
          {resource.type !== 4 ? (
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void canvasCreateGeneratedResourceAsset(projectId, resource.id, {
                  expected_revision: resource.revision,
                })
                  .then(changed)
                  .catch(() => {})
                  .finally(() => setBusy(false));
              }}
            >
              <ImagePlus className="size-4" />
              新建生成素材
            </Button>
          ) : null}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="grid grid-cols-2 gap-4 p-1 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton className="aspect-square rounded-2xl" key={index} />
            ))}
          </div>
        ) : failed ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>素材加载失败，请稍后重试</p>
            <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
              重新加载
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Images className="size-14 stroke-1" />
            <p className="font-medium text-foreground">{query.trim() ? "没有找到相关素材" : "暂无素材，快去添加"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 p-1 md:grid-cols-3 lg:grid-cols-4">
            {visible.map((asset) => (
              <article
                className="group min-w-0 overflow-hidden rounded-2xl border border-transparent p-[3px] transition-colors hover:border-border"
                key={asset.id}
              >
                <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                  {asset.has_content ? (
                    <ResourceMedia
                      key={`${asset.id}:${asset.revision}`}
                      projectId={projectId}
                      assetId={asset.id}
                      name={asset.name}
                      type={asset.media_type}
                      compact
                      className="transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                      <ImagePlus className="size-9 stroke-1" />
                      <span>等待生成</span>
                    </div>
                  )}
                  {resource.primary_resource_asset_id === asset.id ? (
                    <Badge className="absolute left-2 top-2 gap-1">
                      <Star className="size-3" />
                      主素材
                    </Badge>
                  ) : null}
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{asset.name}</span>
                    {onCopy ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !asset.has_content}
                        onClick={() => {
                          setBusy(true);
                          void onCopy(asset.id)
                            .catch(() => {})
                            .finally(() => setBusy(false));
                        }}
                      >
                        复制到画布
                      </Button>
                    ) : null}
                  </div>
                  {asset.source_type === 2 ? (
                    <ResourceGeneration projectId={projectId} asset={asset} siblings={items} onChange={changed} />
                  ) : null}
                  <ResourceAssetActions projectId={projectId} resource={resource} asset={asset} onChange={changed} />
                </div>
              </article>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

import {
  canvasCreateGeneratedResourceAsset,
  canvasListResourceAssets,
  canvasUploadResourceAsset,
  type CanvasResource,
  type CanvasResourceAsset,
} from "@repo/api";
import { Button, Skeleton } from "@repo/design-system";
import { useEffect, useRef, useState } from "react";

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
  return (
    <div className="space-y-3 p-3">
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
            .then(() => {
              setReload((v) => v + 1);
              onChange();
            })
            .catch(() => {})
            .finally(() => setBusy(false));
        }}
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "处理中…" : "上传素材"}
      </Button>
      {resource.type !== 4 ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void canvasCreateGeneratedResourceAsset(projectId, resource.id, { expected_revision: resource.revision })
              .then(() => {
                setReload((v) => v + 1);
                onChange();
              })
              .catch(() => {})
              .finally(() => setBusy(false));
          }}
        >
          添加生成素材
        </Button>
      ) : null}
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : failed ? (
        <Button variant="ghost" onClick={() => setReload((v) => v + 1)}>
          加载失败，重试
        </Button>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">尚未添加素材</p>
      ) : (
        items.map((asset) => (
          <div className="space-y-2 rounded-lg border p-2" key={asset.id}>
            {asset.has_content ? (
              <ResourceMedia
                key={`${asset.id}:${asset.revision}`}
                projectId={projectId}
                assetId={asset.id}
                name={asset.name}
                type={asset.media_type}
              />
            ) : (
              <div className="flex h-24 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
                尚未生成图片
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm">{asset.name}</span>
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
              <ResourceGeneration
                projectId={projectId}
                asset={asset}
                siblings={items}
                onChange={() => {
                  setReload((v) => v + 1);
                  onChange();
                }}
              />
            ) : null}
            <ResourceAssetActions
              projectId={projectId}
              resource={resource}
              asset={asset}
              onChange={() => {
                setReload((v) => v + 1);
                onChange();
              }}
            />
          </div>
        ))
      )}
    </div>
  );
}

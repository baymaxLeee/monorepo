import {
  canvasListResources,
  canvasListResourceAssets,
  type CanvasResource,
  type CanvasResourceAsset,
} from "@repo/api";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Button,
  Input,
  Skeleton,
} from "@repo/design-system";
import { Image, Mountain, Music, Package, Plus, Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { ResourceMedia } from "./ResourceMedia";

import styles from "./StudioAssetPanel.module.less";

const categories = [
  { type: 1, label: "角色", icon: UserRound },
  { type: 2, label: "场景", icon: Mountain },
  { type: 3, label: "道具", icon: Package },
  { type: 4, label: "音频", icon: Music },
];

export function StudioAssets({ projectId, onCopy }: { projectId: string; onCopy: (assetId: string) => Promise<void> }) {
  const [category, setCategory] = useState(1);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CanvasResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener("canvas:resources-changed", refresh);
    return () => window.removeEventListener("canvas:resources-changed", refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void canvasListResources(projectId, { signal: controller.signal, skipErrorNotify: true })
      .then((result) => {
        if (!controller.signal.aborted) {
          setItems(result.items);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, version]);
  const visible = items.filter(
    (item) => item.type === category && item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <div className={`${styles.assetBody} h-full`}>
      <nav className={styles.typeNav} aria-label="素材分类">
        {categories.map(({ type, label, icon: Icon }) => (
          <button
            type="button"
            key={type}
            className={category === type ? styles.activeTypeButton : styles.typeButton}
            onClick={() => setCategory(type)}
            aria-pressed={category === type}
          >
            <span>
              <Icon className="size-4" />
            </span>
            {label}
          </button>
        ))}
      </nav>
      <div className={styles.assetContent}>
        <div className={styles.searchContainer}>
          <div className="relative mb-3 min-w-0 flex-1">
            <Search className="absolute left-3 top-2 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索项目资产"
              placeholder="输入名称搜索"
              className="h-8 rounded-lg border-0 bg-black/5 pl-8 text-[13px] shadow-none"
            />
          </div>
        </div>
        <div className={styles.assetList}>
          {loading ? (
            <Skeleton className="h-24" />
          ) : failed ? (
            <Button variant="ghost" onClick={() => setVersion((value) => value + 1)}>
              加载失败，重试
            </Button>
          ) : !visible.length ? (
            <div className={styles.empty}>{query ? "没有匹配资产" : "暂无项目资产"}</div>
          ) : (
            <Accordion type="multiple">
              {visible.map((resource) => (
                <AccordionItem key={resource.id} value={resource.id} className="border-0">
                  <AccordionTrigger className="h-[42px] gap-2 py-0 text-[13px] hover:no-underline">
                    <span className="min-w-0 truncate">{resource.name}</span>
                    <span className="mr-auto text-muted-foreground">{resource.resource_asset_count}</span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-1">
                    <AssetItems
                      key={`${resource.id}:${resource.revision}`}
                      projectId={projectId}
                      resource={resource}
                      onCopy={onCopy}
                    />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </div>
    </div>
  );
}

function AssetItems({
  projectId,
  resource,
  onCopy,
}: {
  projectId: string;
  resource: CanvasResource;
  onCopy: (id: string) => Promise<void>;
}) {
  const [items, setItems] = useState<CanvasResourceAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void canvasListResourceAssets(projectId, resource.id, { signal: controller.signal, skipErrorNotify: true })
      .then(({ items: assets }) => {
        if (!controller.signal.aborted) {
          setItems(assets);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, resource.id, reload]);
  if (loading) return <Skeleton className="h-10" />;
  if (failed)
    return (
      <Button variant="ghost" size="sm" onClick={() => setReload((value) => value + 1)}>
        读取失败，重试
      </Button>
    );
  return items.length ? (
    items.map((asset) => (
      <button
        type="button"
        key={asset.id}
        disabled={busy || !asset.has_content}
        className={`${styles.assetItem} group disabled:opacity-50`}
        onClick={() => {
          setBusy(true);
          void onCopy(asset.id)
            .catch(() => {})
            .finally(() => setBusy(false));
        }}
        title="添加到画布"
      >
        <span className={styles.thumbnail}>
          {asset.has_content && asset.media_type === 1 ? (
            <ResourceMedia projectId={projectId} assetId={asset.id} name={asset.name} type={1} compact />
          ) : asset.media_type === 3 ? (
            <Music />
          ) : (
            <Image />
          )}
        </span>
        <span className={styles.assetName}>{asset.name}</span>
        <Plus className="size-4 shrink-0 opacity-0 group-hover:opacity-100 group-focus:opacity-100" />
      </button>
    ))
  ) : (
    <p className={styles.groupStatus}>暂无素材</p>
  );
}

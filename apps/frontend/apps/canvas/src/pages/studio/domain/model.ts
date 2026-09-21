import { canvasnode } from "@/domain";
import t from "@/utils/i18n";
import { resolveUpPreviewURL } from "@/utils/upPreviewURL";

import { ASSET_ACCEPT, type AssetCategory, type Shot, type StoryboardAsset } from "./types";

const CATEGORIES: AssetCategory[] = ["image", "video", "audio"];

function canvasNodeAssetCategory(type: canvasnode.CanvasNodeType): StoryboardAsset["category"] {
  if (type === canvasnode.CanvasNodeType.VIDEO_ASSET || type === canvasnode.CanvasNodeType.VIDEO_GENERATION) {
    return "video";
  }
  if (type === canvasnode.CanvasNodeType.AUDIO_ASSET) return "audio";
  if (type === canvasnode.CanvasNodeType.TEXT || type === canvasnode.CanvasNodeType.TEXT_GENERATION) {
    return "text";
  }
  return "image";
}

/** CanvasNode 始终足以投影一个 mention；展示详情只能增强，不能决定引用是否存在。 */
export function assetFromCanvasNode(
  node: canvasnode.CanvasNode,
  detail?: StoryboardAsset,
  targetPort?: canvasnode.CanvasPort,
): StoryboardAsset {
  const category = canvasNodeAssetCategory(node.Type);
  const assetId = materializedCanvasNodeAssetId(node, detail?.assetId);
  const detailMatchesAsset = !assetId || detail?.assetId === assetId;
  const nodePreviewURL = node.SelectedOutputURL ?? node.PreviewURL;
  const nodePreview = nodePreviewURL ? resolveUpPreviewURL(nodePreviewURL) : undefined;
  const description =
    node.Type === canvasnode.CanvasNodeType.TEXT_GENERATION
      ? (node.SelectedOutputText ?? "")
      : (node.Text ?? node.Prompt ?? "");
  return {
    ...detail,
    id: node.NodeID,
    assetId,
    canvasNodeId: node.NodeID,
    category,
    description: detail?.description ?? description,
    previewUrl: nodePreview ?? (detailMatchesAsset ? detail?.previewUrl : undefined),
    referenceType: "canvasNode",
    resourceId: node.ResourceID,
    resourceAssetId: node.ResourceAssetID,
    review: detailMatchesAsset ? detail?.review : undefined,
    reviews: detailMatchesAsset ? detail?.reviews : undefined,
    source: "canvasnode",
    syncStatus: "ready",
    targetPort,
    thumbnail: (category === "image" ? nodePreview : undefined) ?? (detailMatchesAsset ? detail?.thumbnail : undefined),
    title: detail?.title || node.Name || t("未命名素材"),
  };
}

/** 物化响应中的节点是当前素材身份的事实来源；候选项只用于兼容旧响应。 */
export function materializedCanvasNodeAssetId(node: canvasnode.CanvasNode, fallback?: string) {
  return node.CurrentAssetID ?? node.AssetID ?? node.SelectedAssetID ?? fallback;
}

/** 分镜素材关系只由目标 IncomingEdges 和源 CanvasNode 计算。 */
export function projectCanvasNodeAssets(
  nodes: readonly canvasnode.CanvasNode[],
  targetNodeId: string,
  detailsByNodeId: ReadonlyMap<string, StoryboardAsset> = new Map(),
) {
  const nodesById = new Map(nodes.map((node) => [node.NodeID, node]));
  const target = nodesById.get(targetNodeId);
  if (!target) return [];
  return target.IncomingEdges.flatMap((edge) => {
    const source = nodesById.get(edge.SourceNodeID);
    return source && source.ReferenceStatus !== canvasnode.CanvasNodeReferenceStatus.DELETED
      ? [assetFromCanvasNode(source, detailsByNodeId.get(source.NodeID), edge.TargetPort)]
      : [];
  });
}

/** 资产条默认允许的全部类别；调用方可传子集限制可上传/统计的类别。 */
export const ALL_ASSET_CATEGORIES: AssetCategory[] = CATEGORIES;

export type AssetCounts = Record<AssetCategory, number>;

export function countAssetsByCategory(assets: StoryboardAsset[]) {
  const counts: AssetCounts = { image: 0, video: 0, audio: 0 };
  for (const asset of assets) {
    if (asset.category !== "text") counts[asset.category] += 1;
  }
  return counts;
}

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  image: t("图片"),
  video: t("视频"),
  audio: t("音频"),
};

export function formatAssetStats(
  counts: AssetCounts,
  limits: Record<AssetCategory, number>,
  categories: AssetCategory[] = CATEGORIES,
  label = t("素材统计"),
) {
  const parts = categories.map((category) => `${CATEGORY_LABEL[category]} ${counts[category]}/${limits[category]}`);
  return t("{label}：{stats}", { label, stats: parts.join("、") });
}

export function assetAccept(categories: AssetCategory[] = CATEGORIES) {
  return categories.map((category) => ASSET_ACCEPT[category]).join(",");
}

export function categoryFromFile(file: File): AssetCategory {
  if (file.type.startsWith("video/")) {
    return "video";
  }
  if (file.type.startsWith("audio/")) {
    return "audio";
  }
  return "image";
}

/** 草稿尚无持久化节点名时，使用生成节点类型作为临时展示名。 */
export function shotLabel(index: number) {
  return t("视频生成{index}", { index: index + 1 });
}

export function shotChipLabel(index: number) {
  return t("视频生成{index}", { index: index + 1 });
}

export function isEditableShot(shot: Shot | undefined) {
  return shot?.status === "empty" || shot?.status === "ready";
}

export function hasStoryboardScript(script: string | undefined) {
  return Boolean(script?.trim());
}

export function parseDurationSeconds(duration: string) {
  const seconds = Number.parseInt(duration, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

const MENTION_ID = /data-id="([^"]+)"/g;

/** 资产条要标出哪些资产已被当前脚本引用，引用信息只存在 mention 节点的属性里。 */
export function collectReferencedAssetIds(script: string) {
  const ids = new Set<string>();
  for (const match of script.matchAll(MENTION_ID)) {
    ids.add(match[1]);
  }
  return ids;
}

/** 资产已绑定到分镜且可用于保存 / 生成。 */
export function isAssetReady(asset: StoryboardAsset) {
  return !asset.syncStatus || asset.syncStatus === "ready";
}

/** 文件已传到 UP，或本来就是已绑定资产。保存时才能拿去建绑定。 */
export function isAssetUploadReady(asset: StoryboardAsset) {
  return isAssetReady(asset) || (asset.syncStatus === "uploaded" && Boolean(asset.blobId));
}

/** 用 AssetID 替换草稿 mention 中的本地临时 ID。 */
export function replaceAssetMentionIds(script: string, replacements: ReadonlyMap<string, string>) {
  return script.replace(MENTION_ID, (mention, id: string) => {
    const replacement = replacements.get(id);
    return replacement ? mention.replace(`data-id="${id}"`, `data-id="${replacement}"`) : mention;
  });
}

/** 素材条展示全部连线媒体；文本连线仍直接在提示词中消费。 */
export function isVisibleStripAsset(asset: StoryboardAsset) {
  return asset.category !== "text";
}

/** 有限并发执行，对齐 notebook 等多文件上传的批量调用方式。 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let firstError: unknown;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (!failed && cursor < items.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = await worker(items[index], index);
        } catch (error) {
          // 不再领取新任务，但要等其他已启动任务结束，调用方才能完整回滚产物。
          if (!failed) {
            failed = true;
            firstError = error;
          }
        }
      }
    }),
  );
  if (failed) {
    throw firstError;
  }
  return results;
}

export function isBlobUrl(url?: string): url is string {
  return Boolean(url?.startsWith("blob:"));
}

/** 导入完成后继续用本地 object URL 展示，避免缩略图再打一次远程预览。 */
export function preferLocalBlobPreview<T extends { previewUrl?: string; thumbnail?: string }>(
  local: { previewUrl?: string; thumbnail?: string } | undefined,
  next: T,
): T {
  if (!local) {
    return next;
  }
  return {
    ...next,
    previewUrl: isBlobUrl(local.previewUrl) ? local.previewUrl : next.previewUrl,
    thumbnail: isBlobUrl(local.thumbnail) ? local.thumbnail : next.thumbnail,
  };
}

function collectBlobUrls(items: Iterable<StoryboardAsset>) {
  const urls = new Set<string>();
  for (const item of items) {
    for (const url of [item.previewUrl, item.thumbnail]) {
      if (isBlobUrl(url)) {
        urls.add(url);
      }
    }
  }
  return urls;
}

/**
 * 释放资产上的本地 Object URL。
 * 上传中途会清掉 pendingFile 但仍短暂保留 blob 预览，因此只认 `blob:` 前缀，
 * 不依赖 pendingFile；同一地址出现在 thumbnail / previewUrl 时只 revoke 一次。
 * 仍在展示的草稿预览由调用方通过 revokeUnusedAssetBlobUrls 延迟释放。
 */
export function revokeAssetBlobUrls(items: Iterable<StoryboardAsset>) {
  const seen = new Set<string>();
  for (const item of items) {
    for (const url of [item.previewUrl, item.thumbnail]) {
      if (!isBlobUrl(url) || seen.has(url)) {
        continue;
      }
      seen.add(url);
      URL.revokeObjectURL(url);
    }
  }
}

/** 上传完成后释放本地 File 引用；Object URL 在素材移除或 Studio 销毁时统一释放。 */
export function releaseAssetLocalFile(item: StoryboardAsset): StoryboardAsset {
  return {
    ...item,
    pendingFile: undefined,
  };
}

/** 只释放已经没有任何资产条 / 预览还在用的 blob，避免导入完成后闪第二次。 */
export function revokeUnusedAssetBlobUrls(removed: Iterable<StoryboardAsset>, remaining: Iterable<StoryboardAsset>) {
  const used = collectBlobUrls(remaining);
  revokeAssetBlobUrls(
    [...removed].map((item) => ({
      ...item,
      previewUrl: item.previewUrl && used.has(item.previewUrl) ? undefined : item.previewUrl,
      thumbnail: item.thumbnail && used.has(item.thumbnail) ? undefined : item.thumbnail,
    })),
  );
}

export function formatTotalDuration(shots: Shot[]) {
  const total = shots.reduce((sum, shot) => sum + parseDurationSeconds(shot.duration), 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

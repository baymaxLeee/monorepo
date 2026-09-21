import type { asset, canvasnode, resource } from "@/domain";

export type AssetMentionCategory = "image" | "video" | "audio" | "text";

export type MentionSourceGroup = "canvasnode" | "project";

export type MentionResourceType = "character" | "scene" | "prop" | "audio";

export type MentionReferenceType = "asset" | "resource" | "resourceAsset" | "canvasNode";

/** 插件真正用到的可视字段；页面侧 StoryboardAsset 是它的超集。 */
export interface AssetMentionItem {
  /** 编辑器 mention 的事实身份；素材落图后是 CanvasNodeID。 */
  id: string;
  /** 唯一活动引用身份类型；其余 ID 只能作为展示投影。 */
  referenceType?: MentionReferenceType;
  /** 独立上传素材的稳定 AssetID；项目资产不得用它作为画布引用事实。 */
  assetId?: string;
  /** 图片项目资产叶子的稳定身份；画布据此解析最新 CurrentAssetID。 */
  resourceAssetId?: string;
  /** 已存在于当前画布时直接连线，不能再次物化为素材节点。 */
  canvasNodeId?: string;
  available?: boolean;
  generating?: boolean;
  title: string;
  category: AssetMentionCategory;
  description?: string;
  thumbnail?: string;
  previewUrl?: string;
  /** 后台切到 AssetID 后短暂保留，供 mention 双键查找。 */
  draftId?: string;
  source?: MentionSourceGroup;
  resourceType?: MentionResourceType;
  /** 音频项目资产的 Resource 身份；画布据此动态跟随 primary 素材。 */
  resourceId?: string;
  review?: asset.AssetReview;
  /** 项目资产叶子是否为所属 Resource 的主素材。 */
  isPrimary?: boolean;
  /** 同一素材在多个权益包下的审核投影。 */
  reviews?: asset.AssetReview[];
}

export type MentionNode = Omit<canvasnode.CanvasNodeAssetMentionNode, "Children"> & {
  Children: MentionNode[];
  DraftID?: string;
  /** 音频项目资产的稳定 Resource 身份；主素材变化时引用仍保持不变。 */
  ResourceID?: string;
  /** 由 Reviews 派生的最新状态，仅供前端树组件消费。 */
  Review?: asset.AssetReview;
  /** 项目资产的展示类型；只用于缺省封面，不参与引用身份判断。 */
  ResourceType?: resource.ResourceType;
};
export interface MentionTreeResult {
  items: MentionNode[];
  nextCursor?: string;
}

/** batch 完成后 draftId → 稳定 AssetID。 */
export interface MentionIdReplacement {
  draftId: string;
  assetId: string;
}

/**
 * TipTap NodeView 脱离页面 React 树，资产快照和 id 稳定事件由工作区 bus 注入。
 */
export interface AssetMentionSource {
  subscribe: (listener: () => void) => () => void;
  subscribeMentionIdResolved: (listener: (replacements: MentionIdReplacement[]) => void) => () => void;
  getSnapshot: () => AssetMentionItem[];
  /** SearchCanvasNodeAssets 直接返回引用、节点、资产三组素材树。 */
  queryTree?: (
    query: string,
    cursor: string | undefined,
    limit: number,
    signal: AbortSignal,
  ) => Promise<MentionTreeResult>;
  /** 选择前完成必要的分镜绑定，成功后才向编辑器插入 mention。 */
  select?: (asset: AssetMentionItem) => Promise<AssetMentionItem>;
  /** 返回 false 时选择仍生效，但编辑器仅清理本次 @ 查询，不插入 mention。 */
  shouldInsertMention?: (asset: AssetMentionItem) => boolean;
  /** 打开单素材合规送审，并在提交成功后回传 Asset 的最新审核属性。 */
  review?: (asset: AssetMentionItem, onUpdated: (review: asset.AssetReview) => void) => void;
  /** 将分镜临时素材原子导入项目资产库。 */
  addToLibrary?: (
    asset: AssetMentionItem,
    input: {
      type: resource.ResourceType;
      name: string;
      description?: string;
    },
  ) => Promise<void>;
}

export interface AssetQueryState {
  query: string;
  items: MentionNode[];
  loading: boolean;
  loadingMore: boolean;
  nextCursor?: string;
}

export interface AssetQueryDataSource {
  cancel: () => void;
  getState: () => AssetQueryState;
  loadMore: () => void;
  query: (query: string) => void;
  refresh: () => void;
  subscribe: (listener: () => void) => () => void;
}

/** mention chip 在保存切换期同时认服务端 ID 与本地草稿 ID。 */
export function findAssetByMentionId(assets: readonly AssetMentionItem[], mentionId: string) {
  return assets.find((item) => item.id === mentionId || item.draftId === mentionId);
}

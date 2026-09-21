import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { CircleAlert as IconExclamationCircle } from "lucide-react";
import { useSyncExternalStore } from "react";

import t from "@/utils/i18n";

import { AssetAvatar } from "./AssetAvatar";
import { type AssetMentionSource, findAssetByMentionId } from "./types";

/**
 * 正常态与缺失态共用一套盒模型，行内混排时宽度表现一致：
 * 4px 内边距 ×2 + 16px 缩略图 + 6px 间距 + 200px 标题 = 230px。
 */
const CHIP_MAX_WIDTH = "max-w-[230px]";
const LABEL_MAX_WIDTH = "max-w-[200px]";

/**
 * MarkdownEditor 给正文 img 定了 `height:auto; margin:1.5em auto`，选择器带两层类，
 * 权重压过单类工具类。缩略图是 flex item，被上下各 ~21px 的外边距一挤，交叉轴算出来是
 * 负数、钳到 0，图就消失了。这里只在编辑器内把这两条按回去。
 */
const AVATAR_RESET = "[&_img]:m-0! [&_img]:h-full!";

/** align-middle 让 chip 以自身中线对齐文字，避免在 26px 行高里被顶高。 */
const CHIP_BASE = `mx-[2px] inline-flex h-6 ${CHIP_MAX_WIDTH} select-none items-center rounded-[6px] border-[0.5px] border-solid align-middle text-[14px] leading-5.5`;

export function createAssetMentionNode(source: AssetMentionSource) {
  return function AssetMentionNode({ node }: NodeViewProps) {
    const assets = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
    const id = String(node.attrs.id ?? "");
    const label = String(node.attrs.label ?? id);
    const asset = findAssetByMentionId(assets, id);

    if (!asset) {
      return (
        <NodeViewWrapper
          as="span"
          className={`${CHIP_BASE} gap-1 border-[color:oklch(0.808 0.114 19.571)] bg-[color:oklch(0.971 0.013 17.38)] px-[6px] text-destructive`}
          title={`${t("{label}（资产已被移除）", { label })}`}
        >
          <IconExclamationCircle />
          {t("资产缺失")}
        </NodeViewWrapper>
      );
    }

    return (
      <NodeViewWrapper
        as="span"
        className={`${CHIP_BASE} gap-[6px] border-border bg-[rgba(26,27,30,0.05)] px-1 tracking-[0.042px] text-foreground`}
        title={asset.description}
      >
        {/* 图片和视频展示缩略画面，视频额外叠加播放标识；音频回退成分类图标。 */}
        <span className={`inline-flex h-4 w-4 shrink-0 overflow-hidden rounded-[5px] text-[12px] ${AVATAR_RESET}`}>
          <AssetAvatar asset={asset} />
        </span>
        <span className={`min-w-0 ${LABEL_MAX_WIDTH} truncate`}>{asset.title}</span>
      </NodeViewWrapper>
    );
  };
}

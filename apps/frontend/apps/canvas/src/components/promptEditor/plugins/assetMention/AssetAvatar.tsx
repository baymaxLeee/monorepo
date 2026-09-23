import {
  Music as IconMusic,
  Image as IconPic,
  Play as IconPlay,
  FileText as IconText,
  Video as IconVideoDefault,
} from "lucide-react";
import { useRef, useState } from "react";

import { resource } from "@/domain";
import { ResourceTypeIcon } from "@/pages/resources/components/ResourceTypeIcon";
import t from "@/utils/i18n";

import { isBlobUrl } from "./mentionTree";
import type { AssetMentionCategory, AssetMentionItem } from "./types";

const CATEGORY_ICON: Record<AssetMentionCategory, typeof IconPic> = {
  image: IconPic,
  video: IconVideoDefault,
  audio: IconMusic,
  text: IconText,
};

const RESOURCE_TYPE: Record<NonNullable<AssetMentionItem["resourceType"]>, resource.ResourceType> = {
  character: resource.ResourceType.CHARACTER,
  scene: resource.ResourceType.SCENE,
  prop: resource.ResourceType.PROP,
  audio: resource.ResourceType.AUDIO,
};

/**
 * 本地 object URL 一旦出现就锁住，导入完成换成签名地址时也不改 src。
 * 和 Cursor / Codex 附件预览一样，用户感知不到后台上传。
 */
export function useStickyBlobUrl(src?: string, identity?: string) {
  const blobUrl = useRef<string | undefined>(undefined);
  const previousIdentity = useRef(identity);
  if (previousIdentity.current !== identity) {
    previousIdentity.current = identity;
    blobUrl.current = undefined;
  }
  if (!src) {
    blobUrl.current = undefined;
    return undefined;
  }
  if (isBlobUrl(src)) {
    blobUrl.current = src;
    return src;
  }
  return blobUrl.current ?? src;
}

/**
 * 资产缩略图。图片使用 thumbnail，视频直接用 previewUrl 提取首帧并叠加播放标识；
 * 音频以及无法加载预览的媒体回退到分类图标。
 */
export function AssetAvatar({
  className = "",
  asset,
  fit = "contain",
}: {
  className?: string;
  asset: Pick<AssetMentionItem, "category" | "previewUrl" | "resourceType" | "thumbnail"> &
    Partial<Pick<AssetMentionItem, "id" | "draftId">>;
  fit?: "contain" | "cover";
}) {
  const preview = useStickyBlobUrl(
    asset.category === "video" ? (asset.previewUrl ?? asset.thumbnail) : asset.thumbnail,
    asset.draftId ?? asset.id,
  );
  // 缩略图就是 artifact storage 的预览地址，会过期也会 404。不接住失败只会留下一个空方块。
  const [failedSrc, setFailedSrc] = useState<string>();

  if (preview && preview !== failedSrc) {
    if (asset.category === "video") {
      return (
        <span className={`relative block h-full w-full ${className}`}>
          <video
            aria-hidden
            className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
            muted
            onError={() => setFailedSrc(preview)}
            playsInline
            preload="metadata"
            src={preview}
          />
          <span
            aria-label={t("视频")}
            className="absolute inset-0 m-auto flex h-1/2 w-1/2 items-center justify-center rounded-[999px] bg-white text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.18)] [&>svg]:h-1/2 [&>svg]:w-1/2"
          >
            <IconPlay />
          </span>
        </span>
      );
    }

    return (
      <img
        alt=""
        className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"} ${className}`}
        onError={() => setFailedSrc(preview)}
        src={preview}
      />
    );
  }

  const CategoryIcon = CATEGORY_ICON[asset.category];
  const resourceType = asset.resourceType;

  return (
    <span className={`flex h-full w-full items-center justify-center bg-muted text-muted-foreground ${className}`}>
      {resourceType ? <ResourceTypeIcon type={RESOURCE_TYPE[resourceType]} /> : <CategoryIcon />}
    </span>
  );
}

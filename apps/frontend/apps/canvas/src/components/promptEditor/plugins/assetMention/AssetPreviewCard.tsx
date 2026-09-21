import { Play as IconPlay } from "lucide-react";
import { useRef, useState } from "react";

import { AudioPlayer } from "@/components/audioPlayer/index";
import { Markdown as MarkDown } from "@/components/compat";
import { VideoPlayer } from "@/components/videoPlayer/index";
import t from "@/utils/i18n";

import { AssetAvatar, useStickyBlobUrl } from "./AssetAvatar";
import { AssetReviewFooter } from "./ReviewStatus";
import type { AssetMentionItem } from "./types";

export const SUGGESTION_PREVIEW_WIDTH = 316;
export const SUGGESTION_PREVIEW_HEIGHT = 294;

export const POPUP_SURFACE =
  "rounded-[12px] border-[0.5px] border-solid border-[color:var(--color-border-3)] bg-white shadow-[0_15px_35px_-2px_rgba(0,0,0,0.05),0_5px_15px_0_rgba(0,0,0,0.05)]";

function AssetPreviewMedia({ asset }: { asset: AssetMentionItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const previewUrl = useStickyBlobUrl(asset.previewUrl, asset.draftId ?? asset.id);

  if (asset.category === "audio") {
    return <AudioPlayer src={previewUrl} />;
  }

  if (asset.category === "text") {
    return (
      <div className="h-[218px] w-full overflow-auto rounded-[8px] bg-[color:var(--color-bg-5)] p-3 text-[13px] leading-5.5 text-[color:var(--color-text-1)]">
        <MarkDown data={asset.description || asset.title} />
      </div>
    );
  }

  return (
    <div className="relative flex h-[218px] w-full items-center justify-center overflow-hidden rounded-[8px] bg-[color:var(--color-bg-5)]">
      {asset.category === "image" && asset.isPrimary ? (
        <span className="absolute left-2 top-2 z-10 inline-flex h-6 items-center rounded-[8px] bg-[#c6e4ff] px-2 text-[13px] font-medium leading-5.5 text-[#031a79]">
          {t("主形象")}
        </span>
      ) : null}
      {asset.category === "video" ? (
        <div className="relative w-full">
          <VideoPlayer
            onEnded={() => setVideoPlaying(false)}
            onPause={() => setVideoPlaying(false)}
            onPlay={() => setVideoPlaying(true)}
            ref={videoRef}
            src={previewUrl}
          />
          {!videoPlaying && previewUrl ? (
            <button
              aria-label={t("播放视频")}
              className="absolute inset-0 m-auto flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border-0 bg-white p-0 text-[28px] text-[color:var(--color-text-1)] shadow-[0_2px_8px_rgba(0,0,0,0.18)]"
              onClick={() => {
                void videoRef.current?.play().catch(() => setVideoPlaying(false));
              }}
              type="button"
            >
              <IconPlay />
            </button>
          ) : null}
        </div>
      ) : previewUrl ? (
        <img alt={asset.title} className="max-h-full max-w-full object-contain" src={previewUrl} />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center text-[color:var(--color-text-3)]">
          <AssetAvatar asset={asset} />
        </span>
      )}
    </div>
  );
}

export function AssetPreviewCard({
  asset,
  onSubmitReview,
  onAddToLibrary,
  showReviewStatus = true,
}: {
  asset: AssetMentionItem;
  onSubmitReview?: (asset: AssetMentionItem) => void;
  onAddToLibrary?: (asset: AssetMentionItem) => void;
  showReviewStatus?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-2 overflow-hidden p-[6px] ${POPUP_SURFACE}`}
      style={{
        width: SUGGESTION_PREVIEW_WIDTH,
        height: asset.category === "audio" ? undefined : SUGGESTION_PREVIEW_HEIGHT,
      }}
    >
      <AssetPreviewMedia asset={asset} />
      <p className="mb-0 truncate px-2 text-[12px] font-medium leading-5 text-[color:var(--color-text-1)]">
        {asset.title}
      </p>
      {asset.category !== "text" && showReviewStatus ? (
        <AssetReviewFooter asset={asset} onAddToLibrary={onAddToLibrary} onSubmit={onSubmitReview} />
      ) : null}
    </div>
  );
}

import { Sparkles as IconAiGenerateVariationSpark, CircleAlert as IconExclamationCircleRedFill } from "lucide-react";

import { GenerationFailureReason } from "@/components/GenerationFailureReason";
import { Button } from "@/components/ui";
import { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import { VideoGenerationFailure } from "../../components/VideoGenerationFailure";

function failureCopy(type: canvasnode.CanvasNodeType) {
  switch (type) {
    case canvasnode.CanvasNodeType.TEXT_GENERATION:
      return {
        fallback: t("文本生成失败，请重试"),
        title: t("文本生成失败"),
      };
    case canvasnode.CanvasNodeType.VIDEO_GENERATION:
      return {
        fallback: t("视频生成失败，请重试"),
        title: t("视频生成失败"),
      };
    default:
      return {
        fallback: t("图片生成失败，请重试"),
        title: t("图片生成失败"),
      };
  }
}

export function CanvasGenerationFailureState({
  message,
  onRetry,
  requestId,
  seedanceTaskId,
  type,
}: {
  code?: string;
  message?: string;
  onRetry: () => void;
  requestId?: string;
  seedanceTaskId?: string;
  type: canvasnode.CanvasNodeType;
}) {
  const copy = failureCopy(type);
  if (type === canvasnode.CanvasNodeType.VIDEO_GENERATION) {
    return (
      <div className="h-full w-full" role="alert">
        <VideoGenerationFailure
          compact
          errorMessage={message}
          onRetry={onRetry}
          requestId={requestId}
          seedanceTaskId={seedanceTaskId}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center" role="alert">
      <IconExclamationCircleRedFill className="text-[40px] text-destructive" />
      <strong className="text-[14px] font-medium leading-6 text-destructive">{copy.title}</strong>
      <GenerationFailureReason reason={message || copy.fallback} />
      <Button
        icon={<IconAiGenerateVariationSpark />}
        onClick={(event) => {
          event.stopPropagation();
          onRetry();
        }}
        size="small"
        type="outline"
      >
        {t("重新生成")}
      </Button>
    </div>
  );
}

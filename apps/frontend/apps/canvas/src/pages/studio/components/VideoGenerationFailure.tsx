import copyToClipboard from "copy-to-clipboard";
import {
  Sparkles as IconAiGenerateVariationSpark,
  Copy as IconCopyFine,
  CircleAlert as IconExclamationCircleRedFill,
} from "lucide-react";

import { Button, Message, Tooltip } from "@/components/ui";
import t from "@/utils/i18n";

export function VideoGenerationFailure({
  compact = false,
  errorMessage,
  seedanceTaskId,
  requestId,
  title = t("视频生成失败"),
  retryDisabled = false,
  onRetry,
}: {
  compact?: boolean;
  errorMessage?: string;
  seedanceTaskId?: string;
  requestId?: string;
  title?: string;
  retryDisabled?: boolean;
  onRetry?: () => void;
}) {
  const message = errorMessage?.trim() || t("视频生成失败，请重试");
  const nativeSeedanceTaskId = seedanceTaskId?.trim();
  const traceId = nativeSeedanceTaskId || requestId?.trim();
  const traceLabel = nativeSeedanceTaskId ? "Seedance Task ID" : t("请求 ID");

  const copyValue = (value: string) => {
    if (copyToClipboard(value)) {
      Message.success(t("复制成功"));
    } else {
      Message.error(t("复制失败，请手动复制"));
    }
  };

  return (
    <div className={`flex h-full w-full flex-col items-center justify-center text-center ${compact ? "px-3" : "px-6"}`}>
      <IconExclamationCircleRedFill aria-hidden className="text-[40px] text-[color:rgb(var(--danger-6))]" />
      <strong
        className={`${compact ? "mt-1 leading-5" : "mt-2 leading-6"} text-[14px] font-medium text-[color:rgb(var(--danger-6))]`}
      >
        {title}
      </strong>
      <div className="mt-0.5 flex w-full items-end justify-center gap-1 text-[color:var(--color-text-3)]">
        <p className="m-0 line-clamp-2 max-w-[calc(100%-24px)] text-center text-[13px] leading-5.5" title={message}>
          {message}
        </p>
        <Tooltip content={t("复制错误信息")} position="top">
          <button
            aria-label={t("复制错误信息")}
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center border-0 bg-[transparent] p-0 text-[14px] text-[color:var(--color-text-3)] hover:text-[color:var(--color-text-1)]"
            onClick={(event) => {
              event.stopPropagation();
              copyValue(message);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            <IconCopyFine aria-hidden />
          </button>
        </Tooltip>
      </div>
      {traceId ? (
        <div
          className={`${compact ? "mt-1 max-w-[260px]" : "mt-2 max-w-[480px]"} flex w-full items-center justify-center gap-1 text-[12px] leading-5`}
        >
          <span className="shrink-0 text-[color:var(--color-text-3)]">{traceLabel}</span>
          <span className="min-w-0 truncate font-medium text-[color:var(--color-text-2)]" title={traceId}>
            {traceId}
          </span>
          <Tooltip content={t("复制 {label}", { label: traceLabel })} position="top">
            <button
              aria-label={t("复制 {label}", { label: traceLabel })}
              className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center border-0 bg-[transparent] p-0 text-[14px] text-[color:var(--color-text-3)] hover:text-[color:var(--color-text-1)]"
              onClick={(event) => {
                event.stopPropagation();
                copyValue(traceId);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              <IconCopyFine aria-hidden />
            </button>
          </Tooltip>
        </div>
      ) : null}
      {onRetry ? (
        <div className={compact ? "mt-2" : "mt-4"}>
          <Button
            disabled={retryDisabled}
            icon={<IconAiGenerateVariationSpark />}
            onClick={(event) => {
              event.stopPropagation();
              onRetry();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            size="small"
            type="outline"
          >
            {t("重新生成")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

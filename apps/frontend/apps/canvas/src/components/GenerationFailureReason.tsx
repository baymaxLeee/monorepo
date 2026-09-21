import copyToClipboard from "copy-to-clipboard";
import { Copy as IconCopyFine } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { EllipsisText as CEllipsis } from "@/components/compat";
import { Message } from "@/components/ui";
import t from "@/utils/i18n";

import styles from "./GenerationFailureReason.module.less";

export function GenerationFailureReason({ reason }: { reason: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const content = containerRef.current?.querySelector<HTMLElement>('[data-testid="c-m-ellipsis-content"]');
    if (!content) return;

    const measure = () => {
      setIsOverflowing(content.scrollHeight > content.clientHeight || content.scrollWidth > content.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [reason]);

  const copy = () => {
    if (copyToClipboard(reason)) {
      Message.success(t("复制成功"));
    } else {
      Message.error(t("复制失败，请重试"));
    }
  };

  return (
    <div
      className="flex max-w-[310px] items-end gap-1 text-[12px] leading-5 text-[color:var(--color-text-3)]"
      ref={containerRef}
    >
      <CEllipsis
        popoverProps={{ position: "top" }}
        className={styles.reason}
        popoverContent={<span className="whitespace-pre-wrap">{reason}</span>}
        showPopover={isOverflowing}
        useCursorPointer={false}
      >
        {reason}
      </CEllipsis>
      <button
        aria-label={t("复制错误原因")}
        className="mb-[3px] flex h-[14px] w-[14px] shrink-0 cursor-pointer items-center justify-center border-0 bg-[transparent] p-0 text-[color:var(--color-grey-4)] hover:text-[color:rgb(var(--primary-6))]"
        onClick={(event) => {
          event.stopPropagation();
          copy();
        }}
        title={t("复制错误原因")}
        type="button"
      >
        <IconCopyFine className="text-[14px]" />
      </button>
    </div>
  );
}

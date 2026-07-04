import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useCallback, useEffect } from "react";
import { cn } from "shared";
import type { ImagePreviewProps } from "./interface";

const ICON_BUTTON =
  "pointer-events-auto inline-flex items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-40";

export function ImagePreview({
  images,
  open,
  index,
  onOpenChange,
  onIndexChange,
  loop = true,
  className,
}: ImagePreviewProps) {
  const count = images.length;
  const safeIndex = Math.min(Math.max(index, 0), Math.max(count - 1, 0));
  const current = images[safeIndex];
  const multiple = count > 1;

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      const raw = safeIndex + delta;
      const next = loop
        ? (raw + count) % count
        : Math.min(Math.max(raw, 0), count - 1);
      onIndexChange(next);
    },
    [count, loop, onIndexChange, safeIndex],
  );

  useEffect(() => {
    if (!open || !multiple) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, multiple, go]);

  const canPrev = loop || safeIndex > 0;
  const canNext = loop || safeIndex < count - 1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "pointer-events-none fixed inset-0 z-50 flex flex-col outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            图片预览
          </DialogPrimitive.Title>

          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <span className="pointer-events-auto text-sm text-white/90 tabular-nums">
              {multiple ? `${safeIndex + 1} / ${count}` : ""}
            </span>
            <div className="flex items-center gap-2">
              {current?.src ? (
                <a
                  href={current.src}
                  download={current.alt || "image"}
                  aria-label="下载"
                  className={cn(ICON_BUTTON, "size-9")}
                >
                  <DownloadIcon className="size-5" />
                </a>
              ) : null}
              <DialogPrimitive.Close
                aria-label="关闭"
                className={cn(ICON_BUTTON, "size-9")}
              >
                <XIcon className="size-5" />
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16">
            {multiple ? (
              <button
                type="button"
                aria-label="上一张"
                disabled={!canPrev}
                onClick={() => go(-1)}
                className={cn(ICON_BUTTON, "absolute left-2 size-10 sm:left-4")}
              >
                <ChevronLeftIcon className="size-6" />
              </button>
            ) : null}

            {current?.src ? (
              <img
                key={safeIndex}
                src={current.src}
                alt={current.alt ?? ""}
                className="pointer-events-auto max-h-full max-w-full select-none object-contain"
                draggable={false}
              />
            ) : (
              <Loader2Icon className="pointer-events-auto size-8 animate-spin text-white/80" />
            )}

            {multiple ? (
              <button
                type="button"
                aria-label="下一张"
                disabled={!canNext}
                onClick={() => go(1)}
                className={cn(
                  ICON_BUTTON,
                  "absolute right-2 size-10 sm:right-4",
                )}
              >
                <ChevronRightIcon className="size-6" />
              </button>
            ) : null}
          </div>

          {current?.caption ? (
            <div className="pointer-events-auto px-4 pb-5 text-center text-sm text-white/80">
              {current.caption}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

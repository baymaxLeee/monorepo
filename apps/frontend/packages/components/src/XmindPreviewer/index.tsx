import { cn } from "shared";
import { forwardRef, lazy, Suspense } from "react";
import type { XMindPreviewerProps, XMindPreviewerRef } from "./interface";

const LazyXMindPreviewer = lazy(() => import("./components/Previewer"));

const XMindPreviewer = forwardRef<XMindPreviewerRef, XMindPreviewerProps>(
  (
    {
      width = "100%",
      height = "100%",
      style,
      className,
      loadingText = "脑图文件解析中...",
      ...props
    },
    ref,
  ) => {
    return (
      <Suspense
        fallback={
          <div
            style={{ ...style, width, height }}
            className={cn(
              "relative min-h-0 overflow-hidden rounded-md border bg-background",
              className,
            )}
          >
            <div className="flex h-full min-h-30 items-center justify-center p-6 text-sm text-muted-foreground">
              {loadingText}
            </div>
          </div>
        }
      >
        <LazyXMindPreviewer
          {...props}
          ref={ref}
          width={width}
          height={height}
          style={style}
          className={className}
          loadingText={loadingText}
        />
      </Suspense>
    );
  },
);

XMindPreviewer.displayName = "XMindPreviewer";

export { XMindPreviewer };
export default XMindPreviewer;
export type { XMindPreviewerProps, XMindPreviewerRef } from "./interface";

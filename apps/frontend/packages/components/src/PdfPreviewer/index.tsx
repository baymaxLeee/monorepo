import { cn } from "shared";
import { forwardRef, lazy, Suspense } from "react";
import type { PdfPreviewerProps, PdfPreviewerRef } from "./interface";

const LazyPdfPreviewer = lazy(() => import("./components/Previewer"));

const PdfPreviewer = forwardRef<PdfPreviewerRef, PdfPreviewerProps>(
  (
    {
      width = "100%",
      height = "100%",
      style,
      className,
      loadingText = "文件解析中...",
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
        <LazyPdfPreviewer
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

PdfPreviewer.displayName = "PdfPreviewer";

export { PdfPreviewer };
export default PdfPreviewer;
export type { PdfPreviewerProps, PdfPreviewerRef } from "./interface";

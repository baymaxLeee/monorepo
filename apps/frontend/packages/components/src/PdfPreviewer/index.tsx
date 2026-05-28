import { forwardRef } from "react";
import { cn } from "shared";
import { Lazy } from "../Lazy";
import type { PdfPreviewerProps, PdfPreviewerRef } from "./interface";

const loadPreviewer = () => import("./components/Previewer");

const PdfPreviewer = forwardRef<PdfPreviewerRef, PdfPreviewerProps>(
  function PdfPreviewer(props, ref) {
    const {
      width = "100%",
      height = "100%",
      style,
      className,
      loadingText = "文件解析中...",
    } = props;
    return (
      <Lazy<PdfPreviewerProps>
        {...props}
        loader={loadPreviewer}
        ref={ref}
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
      />
    );
  },
);

export { PdfPreviewer };
export default PdfPreviewer;
export type { PdfPreviewerProps, PdfPreviewerRef } from "./interface";

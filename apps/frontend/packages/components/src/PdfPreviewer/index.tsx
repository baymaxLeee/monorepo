import { cn } from "shared";
import { createLazyComponent } from "../Lazy";
import type { PdfPreviewerProps, PdfPreviewerRef } from "./interface";

const PdfPreviewer = createLazyComponent<PdfPreviewerProps, PdfPreviewerRef>(
  () => import("./components/Previewer"),
  ({
    width = "100%",
    height = "100%",
    style,
    className,
    loadingText = "文件解析中...",
  }) => (
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
  ),
);

PdfPreviewer.displayName = "PdfPreviewer";

export { PdfPreviewer };
export default PdfPreviewer;
export type { PdfPreviewerProps, PdfPreviewerRef } from "./interface";

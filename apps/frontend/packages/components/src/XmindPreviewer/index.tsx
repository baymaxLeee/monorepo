import { cn } from "shared";
import { createLazyComponent } from "../Lazy";
import type { XMindPreviewerProps, XMindPreviewerRef } from "./interface";

const XMindPreviewer = createLazyComponent<
  XMindPreviewerProps,
  XMindPreviewerRef
>(
  () => import("./components/Previewer"),
  ({
    width = "100%",
    height = "100%",
    style,
    className,
    loadingText = "脑图文件解析中...",
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

XMindPreviewer.displayName = "XMindPreviewer";

export { XMindPreviewer };
export default XMindPreviewer;
export type { XMindPreviewerProps, XMindPreviewerRef } from "./interface";

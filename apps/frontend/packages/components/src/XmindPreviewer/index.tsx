import { forwardRef } from "react";
import { cn } from "shared";
import { Lazy } from "../Lazy";
import type { XMindPreviewerProps, XMindPreviewerRef } from "./interface";

const loadPreviewer = () => import("./components/Previewer");

const XMindPreviewer = forwardRef<XMindPreviewerRef, XMindPreviewerProps>(
  function XMindPreviewer(props, ref) {
    const {
      width = "100%",
      height = "100%",
      style,
      className,
      loadingText = "脑图文件解析中...",
    } = props;
    return (
      <Lazy<XMindPreviewerProps>
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

export { XMindPreviewer };
export default XMindPreviewer;
export type { XMindPreviewerProps, XMindPreviewerRef } from "./interface";

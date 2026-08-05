import { Lazy } from "@repo/design-system/lazy";
import { cn } from "@repo/shared";
import { forwardRef } from "react";

import type { MarkdownEditorProps, MarkdownEditorRef } from "./interface";

const loadEditor = () => import("./components/Editor");

const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(function MarkdownEditor(props, ref) {
  const { style, className, loadingText = "编辑器加载中..." } = props;
  return (
    <Lazy<MarkdownEditorProps>
      {...props}
      loader={loadEditor}
      ref={ref}
      fallback={
        <div style={style} className={cn("min-h-30", className)}>
          <div className="flex min-h-30 items-center justify-center p-6 text-center text-sm leading-6 text-muted-foreground">
            {loadingText}
          </div>
        </div>
      }
    />
  );
});

export { MarkdownEditor };
export default MarkdownEditor;

export type { MarkdownEditorProps, MarkdownEditorRef } from "./interface";

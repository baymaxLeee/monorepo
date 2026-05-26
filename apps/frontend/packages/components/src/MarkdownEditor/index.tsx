import { cn } from "shared";
import { forwardRef, lazy, Suspense } from "react";
import type { MarkdownEditorProps, MarkdownEditorRef } from "./interface";

const LazyMarkdownEditor = lazy(() => import("./components/Editor"));

const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(
  ({ style, className, loadingText = "编辑器加载中...", ...props }, ref) => {
    return (
      <Suspense
        fallback={
          <div style={style} className={cn("min-h-30", className)}>
            <div className="flex min-h-30 items-center justify-center p-6 text-center text-sm leading-6 text-muted-foreground">
              {loadingText}
            </div>
          </div>
        }
      >
        <LazyMarkdownEditor
          {...props}
          ref={ref}
          style={style}
          className={className}
        />
      </Suspense>
    );
  },
);

MarkdownEditor.displayName = "MarkdownEditor";

export { MarkdownEditor };
export default MarkdownEditor;

export type { MarkdownEditorProps, MarkdownEditorRef } from "./interface";

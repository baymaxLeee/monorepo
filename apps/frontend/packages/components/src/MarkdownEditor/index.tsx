import { cn } from "shared";
import { createLazyComponent } from "../Lazy";
import type { MarkdownEditorProps, MarkdownEditorRef } from "./interface";

const MarkdownEditor = createLazyComponent<
  MarkdownEditorProps,
  MarkdownEditorRef
>(
  () => import("./components/Editor"),
  ({ style, className, loadingText = "编辑器加载中..." }) => (
    <div style={style} className={cn("min-h-30", className)}>
      <div className="flex min-h-30 items-center justify-center p-6 text-center text-sm leading-6 text-muted-foreground">
        {loadingText}
      </div>
    </div>
  ),
);

MarkdownEditor.displayName = "MarkdownEditor";

export { MarkdownEditor };
export default MarkdownEditor;

export type { MarkdownEditorProps, MarkdownEditorRef } from "./interface";

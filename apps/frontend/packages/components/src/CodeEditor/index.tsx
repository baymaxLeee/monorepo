import { cn } from "shared";
import { createLazyComponent } from "../Lazy";
import type { CodeEditorProps } from "./interface";

export const CodeEditor = createLazyComponent<CodeEditorProps>(
  () => import("./component"),
  ({ style, className, loadingText = "编辑器加载中..." }) => (
    <div style={style} className={cn("code-editor", className)}>
      <div className="flex h-full min-h-30 items-center justify-center p-6 text-center text-sm leading-6 text-muted-foreground">
        {loadingText}
      </div>
    </div>
  ),
);

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;

export type { Extension } from "@codemirror/state";
export type { CodeEditorProps } from "./interface";

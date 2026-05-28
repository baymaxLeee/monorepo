import { cn } from "shared";
import { Lazy } from "../Lazy";
import type { CodeEditorProps } from "./interface";

const loadEditor = () => import("./component");

export function CodeEditor(props: CodeEditorProps) {
  const { style, className, loadingText = "编辑器加载中..." } = props;
  return (
    <Lazy<CodeEditorProps>
      {...props}
      loader={loadEditor}
      fallback={
        <div style={style} className={cn("code-editor", className)}>
          <div className="flex h-full min-h-30 items-center justify-center p-6 text-center text-sm leading-6 text-muted-foreground">
            {loadingText}
          </div>
        </div>
      }
    />
  );
}

export default CodeEditor;

export type { Extension } from "@codemirror/state";
export type { CodeEditorProps } from "./interface";

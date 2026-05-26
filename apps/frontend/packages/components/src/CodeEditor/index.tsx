import { cn } from "shared";
import { lazy, Suspense } from "react";
import type { CodeEditorProps } from "./interface";

const LazyCodeEditor = lazy(() => import("./component"));

export const CodeEditor: React.FC<CodeEditorProps> = ({
  style,
  className,
  loadingText = "编辑器加载中...",
  ...props
}) => {
  return (
    <Suspense
      fallback={
        <div style={style} className={cn("h-full", className)}>
          <div className="flex h-full min-h-30 items-center justify-center p-6 text-center text-sm leading-6 text-muted-foreground">
            {loadingText}
          </div>
        </div>
      }
    >
      <LazyCodeEditor {...props} style={style} className={className} />
    </Suspense>
  );
};

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;

export type { Extension } from "@codemirror/state";
export type { CodeEditorProps } from "./interface";

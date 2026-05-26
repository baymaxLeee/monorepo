import { cn } from "shared";
import { forwardRef, lazy, Suspense } from "react";
import type { FileWorkspaceProps, FileWorkspaceRef } from "./interface";

const LazyFileWorkspace = lazy(() => import("./components/Workspace"));

export const FileWorkspace = forwardRef<FileWorkspaceRef, FileWorkspaceProps>(
  (
    {
      height = "100%",
      style,
      className,
      loadingText = "工作区加载中...",
      ...props
    },
    ref,
  ) => {
    return (
      <Suspense
        fallback={
          <div
            className={cn(
              "flex min-h-0 rounded-md border bg-background",
              className,
            )}
            style={{ height, ...style }}
          >
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              {loadingText}
            </div>
          </div>
        }
      >
        <LazyFileWorkspace
          {...props}
          ref={ref}
          height={height}
          style={style}
          className={className}
        />
      </Suspense>
    );
  },
);

FileWorkspace.displayName = "FileWorkspace";

export default FileWorkspace;

export type { Extension } from "@codemirror/state";
export type {
  FileWorkspaceProps,
  FileWorkspaceRef,
  FileChange,
  FileNode,
  FileTab,
} from "./interface";
export { ChangeAction } from "./interface";

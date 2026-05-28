import { forwardRef } from "react";
import { cn } from "shared";
import { Lazy } from "../Lazy";
import type { FileWorkspaceProps, FileWorkspaceRef } from "./interface";

const loadWorkspace = () => import("./components/Workspace");

const FileWorkspace = forwardRef<FileWorkspaceRef, FileWorkspaceProps>(
  function FileWorkspace(props, ref) {
    const {
      height = "100%",
      style,
      className,
      loadingText = "工作区加载中...",
    } = props;
    return (
      <Lazy<FileWorkspaceProps>
        {...props}
        loader={loadWorkspace}
        ref={ref}
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
      />
    );
  },
);

export { FileWorkspace };
export default FileWorkspace;

export type { Extension } from "@codemirror/state";
export type {
  FileChange,
  FileNode,
  FileTab,
  FileWorkspaceProps,
  FileWorkspaceRef,
} from "./interface";
export { ChangeAction } from "./interface";

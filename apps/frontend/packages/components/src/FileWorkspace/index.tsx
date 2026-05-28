import { cn } from "shared";
import { createLazyComponent } from "../Lazy";
import type { FileWorkspaceProps, FileWorkspaceRef } from "./interface";

export const FileWorkspace = createLazyComponent<
  FileWorkspaceProps,
  FileWorkspaceRef
>(
  () => import("./components/Workspace"),
  ({ height = "100%", style, className, loadingText = "工作区加载中..." }) => (
    <div
      className={cn("flex min-h-0 rounded-md border bg-background", className)}
      style={{ height, ...style }}
    >
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {loadingText}
      </div>
    </div>
  ),
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

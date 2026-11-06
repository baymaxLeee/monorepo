import { FileTree, FileTreeFile, FileTreeFolder } from "@repo/ai-elements";
import { useState } from "react";

export interface ChatFileEntry {
  path: string;
  title?: string;
  documentId?: string;
}

export function parseChatFiles(value: unknown): ChatFileEntry[] | null {
  if (!value || typeof value !== "object" || !("files" in value) || !Array.isArray(value.files)) return null;
  return value.files.flatMap((file: unknown) => {
    if (!file || typeof file !== "object" || !("path" in file) || typeof file.path !== "string") return [];
    return [
      {
        path: file.path,
        title: "title" in file && typeof file.title === "string" ? file.title : undefined,
        documentId: "document_id" in file && typeof file.document_id === "string" ? file.document_id : undefined,
      },
    ];
  });
}

type Folder = { files: ChatFileEntry[]; folders: Map<string, Folder> };
function groupFiles(files: ChatFileEntry[]) {
  const root: Folder = { files: [], folders: new Map() };
  for (const file of files) {
    let parent = root;
    for (const segment of file.path.split("/").slice(0, -1)) {
      if (!parent.folders.has(segment)) parent.folders.set(segment, { files: [], folders: new Map() });
      parent = parent.folders.get(segment)!;
    }
    parent.files.push(file);
  }
  return root;
}
function FolderContents({ folder }: { folder: Folder }) {
  return (
    <>
      {[...folder.folders].map(([name, child]) => (
        <FileTreeFolder key={name} name={name} defaultOpen>
          <FolderContents folder={child} />
        </FileTreeFolder>
      ))}
      {folder.files.map((file) => (
        <FileTreeFile key={file.path} path={file.path} name={file.title} title={file.path} />
      ))}
    </>
  );
}

export function ChatFileTree({
  files,
  onOpenFile,
  onOpenArtifact,
}: {
  files: ChatFileEntry[];
  onOpenFile: (path: string) => void;
  onOpenArtifact: (id: string) => void;
}) {
  const [visible, setVisible] = useState(100);
  if (!files.length) return <p className="text-xs text-muted-foreground">暂无文件</p>;
  return (
    <>
      <FileTree
        aria-label="会话文件"
        onSelect={(path) => {
          const file = files.find((entry) => entry.path === path);
          if (file?.documentId) onOpenArtifact(file.documentId);
          else if (path.startsWith("documents/")) onOpenArtifact(path.slice("documents/".length));
          else onOpenFile(path);
        }}
      >
        <FolderContents folder={groupFiles(files.slice(0, visible))} />
      </FileTree>
      {visible < files.length && (
        <button
          type="button"
          className="px-3 py-2 text-sm underline"
          onClick={() => setVisible((count) => count + 100)}
        >
          显示更多文件（剩余 {files.length - visible}）
        </button>
      )}
    </>
  );
}

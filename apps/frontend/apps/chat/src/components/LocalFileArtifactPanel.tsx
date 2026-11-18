import { FileArtifactPanel } from "@repo/ai-elements/conversation/components/FileArtifactPanel";
import type { DesktopBridge } from "@repo/runtime/desktop";

import { useLocalFileEditor } from "../hooks/useLocalFileEditor";

function localMediaType(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return (
    {
      css: "text/css",
      csv: "text/csv",
      html: "text/html",
      htm: "text/html",
      js: "text/javascript",
      json: "application/json",
      jsx: "text/jsx",
      md: "text/markdown",
      mjs: "text/javascript",
      py: "text/x-python",
      ts: "text/typescript",
      tsx: "text/tsx",
      txt: "text/plain",
      yaml: "application/yaml",
      yml: "application/yaml",
    }[extension ?? ""] ?? "text/plain"
  );
}

export function LocalFileArtifactPanel({
  bridge,
  threadId,
  path,
  onClose,
}: {
  bridge: DesktopBridge;
  threadId: string;
  path: string;
  onClose: () => void;
}) {
  const { file, savedContent, editor } = useLocalFileEditor(bridge, threadId, path);
  const filename = path.split("/").at(-1) ?? path;
  return (
    <FileArtifactPanel
      file={
        file
          ? {
              id: `${threadId}:${path}`,
              title: filename,
              filename,
              mimeType: localMediaType(path),
              editable: true,
            }
          : null
      }
      editor={editor}
      previewContent={savedContent}
      revision={file?.hash ?? path}
      onClose={onClose}
    />
  );
}

import { FileArtifactPanel } from "@repo/ai-elements/conversation/components/FileArtifactPanel";
import type { DesktopBridge } from "@repo/runtime/desktop";

import { useLocalFileEditor } from "../hooks/useLocalFileEditor";

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
              editable: true,
            }
          : null
      }
      editor={editor}
      previewContent={savedContent}
      revision={path}
      onClose={onClose}
    />
  );
}

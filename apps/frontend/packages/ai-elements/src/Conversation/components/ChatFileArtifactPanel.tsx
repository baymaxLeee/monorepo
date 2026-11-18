import { createStorageDownloadUrl, downloadAssetUrl } from "@repo/api";
import { useShallow } from "zustand/react/shallow";

import { useChatStore } from "../store/useChatStore";
import { FileArtifactPanel } from "./FileArtifactPanel";
import { useConversationFileEditor } from "./useConversationFileEditor";

export function ChatFileArtifactPanel({ onClose }: { onClose?: () => void }) {
  const { artifactPreview, closeArtifactPreview } = useChatStore(
    useShallow((state) => ({
      artifactPreview: state.artifactPreview,
      closeArtifactPreview: state.closeArtifactPreview,
    })),
  );
  const { open, conversationId, fileId, token } = artifactPreview;
  const editor = useConversationFileEditor(conversationId, fileId, open, token);
  const file = editor.file?.id === fileId ? editor.file : null;
  return (
    <FileArtifactPanel
      file={
        file
          ? {
              id: file.id,
              title: file.title,
              filename: file.filename,
              mimeType: file.mime_type,
              editable: file.editable,
            }
          : null
      }
      editor={editor}
      previewAsset={
        file && conversationId
          ? {
              assetId: file.asset_id,
              revisionId: file.revision_id,
              owner: { kind: "conversation-file", conversationId, fileId: file.id },
            }
          : undefined
      }
      revision={token}
      onDownload={
        file && conversationId
          ? async () => {
              const capability = await createStorageDownloadUrl({
                assetId: file.asset_id,
                revisionId: file.revision_id,
                owner: { kind: "conversation-file", conversationId, fileId: file.id },
              });
              downloadAssetUrl(capability.url, capability.filename);
            }
          : undefined
      }
      onClose={
        onClose
          ? () => {
              void editor.requestNavigation().then((allowed) => {
                if (allowed) onClose();
              });
            }
          : closeArtifactPreview
      }
    />
  );
}

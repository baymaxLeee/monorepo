import { Spinner } from "@repo/design-system";
import { lazy, Suspense } from "react";

import { useChatStore } from "../store/useChatStore";

const DocumentPanel = lazy(() =>
  import("./ChatDocumentArtifactPanel").then((m) => ({ default: m.ChatDocumentArtifactPanel })),
);
const FilePanel = lazy(() => import("./ChatFileArtifactPanel").then((m) => ({ default: m.ChatFileArtifactPanel })));

export function ChatArtifactPanel({ onClose }: { onClose?: () => void }) {
  const fileId = useChatStore((state) => state.artifactPreview.fileId);
  return (
    <Suspense
      fallback={
        <div role="status" className="flex h-full items-center justify-center">
          <Spinner aria-label="加载预览" />
        </div>
      }
    >
      {fileId ? <FilePanel onClose={onClose} /> : <DocumentPanel onClose={onClose} />}
    </Suspense>
  );
}

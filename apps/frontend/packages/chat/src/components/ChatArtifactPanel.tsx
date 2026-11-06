import { Spinner } from "@repo/design-system";
import { lazy, Suspense } from "react";

import { useChatStore } from "../store/useChatStore";

const DocumentPanel = lazy(() =>
  import("./ChatDocumentArtifactPanel").then((m) => ({ default: m.ChatDocumentArtifactPanel })),
);
const FilePanel = lazy(() => import("./ChatFileArtifactPanel").then((m) => ({ default: m.ChatFileArtifactPanel })));

export function ChatArtifactPanel({ onClose }: { onClose?: () => void }) {
  const path = useChatStore((state) => state.artifactPreview.path);
  return (
    <Suspense
      fallback={
        <div role="status" className="flex h-full items-center justify-center">
          <Spinner aria-label="加载预览" />
        </div>
      }
    >
      {path ? <FilePanel onClose={onClose} /> : <DocumentPanel onClose={onClose} />}
    </Suspense>
  );
}

import { Spinner } from "@repo/design-system";
import { getDesktopBridge } from "@repo/runtime/desktop";
import { lazy, memo, Suspense } from "react";

import type { LocalArtifact } from "../stores/useLocalArtifact";

const Artifact = lazy(() =>
  import("@repo/ai-elements/conversation/components/ChatArtifactPanel").then((m) => ({ default: m.ChatArtifactPanel })),
);
const LocalFilePanel = lazy(() =>
  import("./LocalFileArtifactPanel").then((m) => ({ default: m.LocalFileArtifactPanel })),
);
export const ChatInspector = memo(function ChatInspector({
  localFile,
  onClose,
}: {
  localFile: LocalArtifact | null;
  onClose: () => void;
}) {
  const bridge = getDesktopBridge();
  return (
    <Suspense
      fallback={
        <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          加载预览…
        </div>
      }
    >
      {localFile && bridge ? (
        <LocalFilePanel key={JSON.stringify(localFile)} bridge={bridge} {...localFile} onClose={onClose} />
      ) : (
        <Artifact />
      )}
    </Suspense>
  );
});

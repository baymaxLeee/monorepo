import { useChatStore } from "@repo/ai-elements/conversation/store/useChatStore";
import { Spinner } from "@repo/design-system";
import { lazy, memo, Suspense } from "react";

import { useLocalWorkspaceStore } from "../stores/useLocalWorkspaceStore";

const Artifact = lazy(() =>
  import("@repo/ai-elements/conversation/components/ChatArtifactPanel").then((m) => ({ default: m.ChatArtifactPanel })),
);
const Video = lazy(() =>
  import("@repo/ai-elements/conversation/components/VideoProductionWorkspace").then((m) => ({
    default: m.VideoProductionWorkspace,
  })),
);
const LocalWorkspace = lazy(() => import("./LocalWorkspacePanel").then((m) => ({ default: m.LocalWorkspacePanel })));

export const ChatInspector = memo(function ChatInspector() {
  const localWorkspaceOpen = useLocalWorkspaceStore((s) => s.open);
  const video = useChatStore((s) => s.videoProductionWorkspace);
  const closeVideo = useChatStore((s) => s.closeVideoProductionWorkspace);
  return (
    <Suspense
      fallback={
        <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          加载预览…
        </div>
      }
    >
      {localWorkspaceOpen ? (
        <LocalWorkspace />
      ) : video.open && video.conversationId && video.productionId ? (
        <Video conversationId={video.conversationId} productionId={video.productionId} onClose={closeVideo} />
      ) : (
        <Artifact />
      )}
    </Suspense>
  );
});

import { useChatStore } from "@repo/chat/store/useChatStore";
import { Spinner } from "@repo/design-system";
import { lazy, memo, Suspense } from "react";

const Artifact = lazy(() =>
  import("@repo/chat/components/ChatArtifactPanel").then((m) => ({ default: m.ChatArtifactPanel })),
);
const Video = lazy(() =>
  import("@repo/chat/components/VideoProductionWorkspace").then((m) => ({ default: m.VideoProductionWorkspace })),
);

export const ChatInspector = memo(function ChatInspector() {
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
      {video.open && video.conversationId && video.productionId ? (
        <Video conversationId={video.conversationId} productionId={video.productionId} onClose={closeVideo} />
      ) : (
        <Artifact />
      )}
    </Suspense>
  );
});

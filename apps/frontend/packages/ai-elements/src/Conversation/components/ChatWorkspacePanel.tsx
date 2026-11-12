import { Spinner } from "@repo/design-system";
import { lazy, Suspense } from "react";

import { useChatStore } from "../store/useChatStore";

const ChatArtifactPanel = lazy(() => import("./ChatArtifactPanel").then((m) => ({ default: m.ChatArtifactPanel })));
const VideoProductionWorkspace = lazy(() =>
  import("./VideoProductionWorkspace").then((m) => ({ default: m.VideoProductionWorkspace })),
);

export function ChatWorkspacePanel({ conversationId }: { conversationId: string }) {
  const artifact = useChatStore((state) => state.artifactPreview);
  const video = useChatStore((state) => state.videoProductionWorkspace);
  const closeVideo = useChatStore((state) => state.closeVideoProductionWorkspace);
  if (artifact.open && artifact.conversationId === conversationId)
    return (
      <div className="absolute inset-0 z-10 bg-background">
        <Suspense fallback={<Spinner aria-label="加载预览" />}>
          <ChatArtifactPanel />
        </Suspense>
      </div>
    );
  if (video.open && video.conversationId === conversationId && video.productionId) {
    return (
      <div className="absolute inset-0 z-10 bg-background">
        <Suspense fallback={<Spinner aria-label="加载预览" />}>
          <VideoProductionWorkspace
            conversationId={conversationId}
            productionId={video.productionId}
            onClose={closeVideo}
          />
        </Suspense>
      </div>
    );
  }
  return null;
}

import { useChatStore } from "../store/useChatStore";
import { ChatArtifactPanel } from "./ChatArtifactPanel";
import { VideoProductionWorkspace } from "./VideoProductionWorkspace";

export function ChatWorkspacePanel({ conversationId }: { conversationId: string }) {
  const artifact = useChatStore((state) => state.artifactPreview);
  const video = useChatStore((state) => state.videoProductionWorkspace);
  const closeVideo = useChatStore((state) => state.closeVideoProductionWorkspace);
  if (artifact.open && artifact.conversationId === conversationId)
    return (
      <div className="absolute inset-0 z-10 bg-background">
        <ChatArtifactPanel />
      </div>
    );
  if (video.open && video.conversationId === conversationId && video.productionId) {
    return (
      <div className="absolute inset-0 z-10 bg-background">
        <VideoProductionWorkspace
          conversationId={conversationId}
          productionId={video.productionId}
          onClose={closeVideo}
        />
      </div>
    );
  }
  return null;
}

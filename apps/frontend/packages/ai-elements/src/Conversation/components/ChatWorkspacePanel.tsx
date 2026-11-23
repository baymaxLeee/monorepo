import { Spinner } from "@repo/design-system";
import { lazy, Suspense } from "react";

import { useChatStore } from "../store/useChatStore";

const ChatArtifactPanel = lazy(() => import("./ChatArtifactPanel").then((m) => ({ default: m.ChatArtifactPanel })));

export function ChatWorkspacePanel({ conversationId }: { conversationId: string }) {
  const artifact = useChatStore((state) => state.artifactPreview);
  if (artifact.open && artifact.conversationId === conversationId)
    return (
      <div className="absolute inset-0 z-10 bg-background">
        <Suspense fallback={<Spinner aria-label="加载预览" />}>
          <ChatArtifactPanel />
        </Suspense>
      </div>
    );
  return null;
}

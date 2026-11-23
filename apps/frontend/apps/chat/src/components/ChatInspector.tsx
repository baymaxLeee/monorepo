import { Spinner } from "@repo/design-system";
import { lazy, memo, Suspense } from "react";

const Artifact = lazy(() =>
  import("@repo/ai-elements/conversation/components/ChatArtifactPanel").then((m) => ({ default: m.ChatArtifactPanel })),
);
export const ChatInspector = memo(function ChatInspector() {
  return (
    <Suspense
      fallback={
        <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          加载预览…
        </div>
      }
    >
      <Artifact />
    </Suspense>
  );
});

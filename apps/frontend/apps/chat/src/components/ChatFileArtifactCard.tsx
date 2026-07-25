import { Button } from "components";
import { Artifact, ArtifactContent, ArtifactDescription, ArtifactHeader, ArtifactTitle } from "components/ai-chat";
import { FileTextIcon } from "lucide-react";

import type { ArtifactOutput } from "./ChatArtifactCard";

export function ArtifactFileCard({
  artifact,
  planExecuted,
  planBusy,
  onOpen,
  onExecutePlan,
}: {
  artifact: ArtifactOutput & { path: string };
  planExecuted?: boolean;
  planBusy?: boolean;
  onOpen: () => void;
  onExecutePlan?: () => void;
}) {
  const isPlan = artifact.kind === "plan" || artifact.path.endsWith("-plan.md");
  return (
    <Artifact>
      <ArtifactHeader>
        <div className="min-w-0">
          <ArtifactTitle className="truncate">{artifact.title}</ArtifactTitle>
          <ArtifactDescription className="truncate">
            {[artifact.kind, artifact.path].filter(Boolean).join(" · ")}
          </ArtifactDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onOpen}>
          {isPlan ? "查看" : "预览"}
        </Button>
        {isPlan ? (
          <Button type="button" size="sm" disabled={planBusy} onClick={onExecutePlan}>
            {planExecuted ? "再次执行" : "立即执行"}
          </Button>
        ) : null}
      </ArtifactHeader>
      <ArtifactContent className="px-4 py-3 text-xs text-muted-foreground">
        <FileTextIcon className="mr-1 inline size-3" />
        AI file
      </ArtifactContent>
    </Artifact>
  );
}

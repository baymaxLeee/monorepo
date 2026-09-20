import { Button, TooltipProvider } from "@repo/design-system";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { ResourceLibrary } from "../components/ResourceLibrary";

export function Component() {
  const { projectId } = useParams();
  if (!projectId) return null;
  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Button asChild variant="ghost" size="icon">
            <Link to={`/platform/canvas/projects/${projectId}`} aria-label="返回项目">
              <ArrowLeft />
            </Link>
          </Button>
          <h1 className="font-medium">项目资产库</h1>
        </header>
        <main className="min-h-0 flex-1">
          <ResourceLibrary projectId={projectId} />
        </main>
      </div>
    </TooltipProvider>
  );
}

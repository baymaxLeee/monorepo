import { canvasCopyResourceToCanvas } from "@repo/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@repo/design-system";
import { useStore } from "jotai";

import { applyGraphAtom } from "../store/graph";
import { useStudioMutationCoordinator } from "../store/mutations";
import { ResourceLibrary } from "./ResourceLibrary";
import { StudioNodePanel } from "./StudioNodePanel";

export function StudioSidebar({
  projectId,
  canvasId,
  busy,
  selectedId,
  onCreate,
  onSelect,
  beforeCopy,
}: {
  projectId: string;
  canvasId: string;
  busy: boolean;
  selectedId: string | null;
  onCreate: (type: number) => void;
  onSelect: (id: string) => void;
  beforeCopy: () => Promise<void>;
}) {
  const store = useStore();
  const coordinator = useStudioMutationCoordinator();
  return (
    <Tabs defaultValue="nodes" className="flex h-full w-80 shrink-0 flex-col gap-0 border-r">
      <TabsList className="m-3 grid grid-cols-2">
        <TabsTrigger value="nodes">节点</TabsTrigger>
        <TabsTrigger value="assets">资产</TabsTrigger>
      </TabsList>
      <TabsContent value="nodes" className="min-h-0">
        <StudioNodePanel busy={busy} selectedId={selectedId} onCreate={onCreate} onSelect={onSelect} />
      </TabsContent>
      <TabsContent value="assets" className="min-h-0">
        <ResourceLibrary
          projectId={projectId}
          onCopy={async (assetId) => {
            await beforeCopy();
            const nodeId = crypto.randomUUID();
            await coordinator.enqueue(async () => {
              store.set(
                applyGraphAtom,
                await canvasCopyResourceToCanvas(canvasId, { node_id: nodeId, resource_asset_id: assetId }),
              );
            });
            onSelect(nodeId);
          }}
        />
      </TabsContent>
    </Tabs>
  );
}

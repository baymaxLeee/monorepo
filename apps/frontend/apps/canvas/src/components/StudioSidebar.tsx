import { canvasCopyResourceToCanvas } from "@repo/api";
import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from "@repo/design-system";
import { useStore } from "jotai";
import { FolderOpen } from "lucide-react";
import { Link } from "react-router-dom";

import { applyGraphAtom } from "../store/graph";
import { useStudioMutationCoordinator } from "../store/mutations";
import { StudioAssets } from "./StudioAssets";
import { StudioNodePanel } from "./StudioNodePanel";

import styles from "./StudioAssetPanel.module.less";

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
    <Tabs defaultValue="nodes" className="flex h-full w-[300px] shrink-0 flex-col gap-0 border-r bg-white pt-12">
      <TabsList className={`${styles.topTabs} w-full justify-start rounded-none bg-white`}>
        <TabsTrigger
          className="h-8 flex-none rounded-lg px-2.5 text-[13px] data-[state=active]:bg-black/5 data-[state=active]:shadow-none"
          value="nodes"
        >
          节点
        </TabsTrigger>
        <TabsTrigger
          className="h-8 flex-none rounded-lg px-2.5 text-[13px] data-[state=active]:bg-black/5 data-[state=active]:shadow-none"
          value="assets"
        >
          资产
        </TabsTrigger>
        <Button asChild size="icon" variant="ghost" className="ml-auto size-8">
          <Link to={`/platform/canvas/projects/${projectId}/resources`} aria-label="打开项目资产库">
            <FolderOpen className="size-4" />
          </Link>
        </Button>
      </TabsList>
      <TabsContent value="nodes" className="min-h-0">
        <StudioNodePanel busy={busy} selectedId={selectedId} onCreate={onCreate} onSelect={onSelect} />
      </TabsContent>
      <TabsContent value="assets" className="min-h-0">
        <StudioAssets
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

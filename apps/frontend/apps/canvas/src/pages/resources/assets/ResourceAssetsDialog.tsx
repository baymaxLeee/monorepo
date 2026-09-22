import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/design-system";

import type { resource } from "@/domain";

import { RESOURCE_ASSETS_MODAL_Z_INDEX } from "../components/resourceAssetsLayers";
import { type ResourceAssetsInitialAction, ResourceAssetsPageContent } from "./ResourceAssetsPage";

import styles from "./ResourceAssetsDialog.module.less";

export function ResourceAssetsDialog({
  initialAction,
  item,
  onChange,
  onClose,
  projectId,
}: {
  initialAction?: ResourceAssetsInitialAction;
  item: resource.Resource;
  onChange: () => void;
  onClose: () => void;
  projectId: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`canvas-web-theme canvas-modal flex max-h-[90dvh] w-[520px] flex-col gap-0 p-0 sm:max-w-none ${styles.modal}`}
        onPointerDownOutside={(event) => event.preventDefault()}
        style={{ maxWidth: "92vw", zIndex: RESOURCE_ASSETS_MODAL_Z_INDEX }}
      >
        <DialogTitle className="sr-only">资产详情</DialogTitle>
        <DialogDescription className="sr-only">查看和管理资产详情</DialogDescription>
        <div className="canvas-modal-content min-h-0 overflow-auto px-6 py-5">
          <ResourceAssetsPageContent
            initialAction={initialAction}
            item={item}
            onChange={onChange}
            onClose={onClose}
            projectId={projectId}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

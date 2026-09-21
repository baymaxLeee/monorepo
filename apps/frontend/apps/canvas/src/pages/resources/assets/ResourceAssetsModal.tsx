import { Modal } from "@/components/ui";
import type { resource } from "@/domain";

import { RESOURCE_ASSETS_MODAL_Z_INDEX } from "../components/resourceAssetsLayers";
import { type ResourceAssetsInitialAction, ResourceAssetsPageContent } from "./ResourceAssetsPage";

import styles from "./ResourceAssetsModal.module.less";

export function ResourceAssetsModal({
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
    <Modal
      className={styles.modal}
      footer={null}
      maskStyle={{ zIndex: RESOURCE_ASSETS_MODAL_Z_INDEX }}
      maskClosable={false}
      onCancel={onClose}
      unmountOnExit
      visible
      wrapStyle={{ zIndex: RESOURCE_ASSETS_MODAL_Z_INDEX }}
    >
      <ResourceAssetsPageContent
        initialAction={initialAction}
        item={item}
        onChange={onChange}
        onClose={() => onClose()}
        projectId={projectId}
      />
    </Modal>
  );
}

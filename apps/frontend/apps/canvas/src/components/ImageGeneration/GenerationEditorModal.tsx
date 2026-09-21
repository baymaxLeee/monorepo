import type { ReactNode } from "react";

import { Modal } from "@/components/ui";

import styles from "./ImageGenerationEditorModal.module.less";

export function GenerationEditorModal({
  children,
  onClose,
  visible,
  zIndex,
}: {
  children: ReactNode;
  onClose: () => void;
  visible: boolean;
  zIndex?: number;
}) {
  return (
    <Modal
      className={styles.modal}
      closable={false}
      footer={null}
      maskStyle={zIndex === undefined ? undefined : { zIndex }}
      maskClosable
      onCancel={onClose}
      unmountOnExit
      visible={visible}
      wrapStyle={zIndex === undefined ? undefined : { zIndex }}
    >
      {children}
    </Modal>
  );
}

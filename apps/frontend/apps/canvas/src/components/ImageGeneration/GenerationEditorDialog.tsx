import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/design-system";
import type { ReactNode } from "react";

import styles from "./ImageGenerationEditorDialog.module.less";

export function GenerationEditorDialog({
  children,
  onClose,
  visible,
}: {
  children: ReactNode;
  onClose: () => void;
  visible: boolean;
}) {
  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`canvas-web-theme canvas-modal flex max-h-[90dvh] w-[520px] flex-col gap-0 p-0 sm:max-w-none ${styles.modal}`}
        showCloseButton={false}
        style={{ maxWidth: "92vw" }}
      >
        <DialogTitle className="sr-only">编辑生成内容</DialogTitle>
        <DialogDescription className="sr-only">编辑当前生成内容</DialogDescription>
        <div className="canvas-modal-content min-h-0 overflow-auto px-6 py-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

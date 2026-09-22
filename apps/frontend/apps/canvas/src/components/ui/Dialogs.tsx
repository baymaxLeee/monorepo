import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@repo/design-system";
import { LoaderCircle } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { Popover } from "./Floating";

export interface ModalProps {
  children?: ReactNode;
  visible?: boolean;
  title?: ReactNode;
  footer?: ReactNode;
  onCancel?: () => void;
  onOk?: () => void | Promise<unknown>;
  okText?: string;
  cancelText?: string;
  confirmLoading?: boolean;
  okButtonProps?: { disabled?: boolean; loading?: boolean };
  cancelButtonProps?: { disabled?: boolean };
  maskClosable?: boolean;
  escToExit?: boolean;
  closable?: boolean;
  unmountOnExit?: boolean;
  className?: string;
  wrapClassName?: string;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  wrapStyle?: CSSProperties;
  maskStyle?: CSSProperties;
  width?: number | string;
  autoFocus?: boolean;
  focusLock?: boolean;
  afterClose?: () => void;
}
export function Modal({
  children,
  visible,
  title,
  footer,
  onCancel,
  onOk,
  okText = "确定",
  cancelText = "取消",
  confirmLoading,
  okButtonProps,
  cancelButtonProps,
  maskClosable = true,
  escToExit = true,
  closable = true,
  className,
  wrapClassName,
  style,
  wrapStyle,
  width,
  autoFocus = true,
}: ModalProps) {
  const [pending, setPending] = useState(false);
  const busy = pending || confirmLoading || okButtonProps?.loading;
  return (
    <Dialog
      open={visible}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel?.();
      }}
    >
      <DialogContent
        className={`canvas-web-theme canvas-modal flex w-[520px] max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-none ${className ?? ""} ${wrapClassName ?? ""}`}
        style={{ ...(width === undefined ? {} : { width }), maxWidth: "92vw", ...wrapStyle, ...style }}
        showCloseButton={closable}
        onOpenAutoFocus={(event) => {
          if (!autoFocus) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!maskClosable || busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (!escToExit || busy) event.preventDefault();
        }}
      >
        <DialogHeader className={title ? "canvas-modal-header shrink-0 border-b px-6 py-5" : "sr-only"}>
          <DialogTitle className="canvas-modal-title">{title ?? "编辑"}</DialogTitle>
          <DialogDescription className="sr-only">
            {typeof title === "string" ? title : "编辑当前内容"}
          </DialogDescription>
        </DialogHeader>
        <div className="canvas-modal-content min-h-0 overflow-auto px-6 py-5">{children}</div>
        {footer !== null && (
          <DialogFooter className="canvas-modal-footer shrink-0 border-t px-6 py-4">
            {footer ?? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || cancelButtonProps?.disabled}
                  onClick={onCancel}
                >
                  {cancelText}
                </Button>
                <Button
                  type="button"
                  disabled={busy || okButtonProps?.disabled}
                  onClick={async () => {
                    setPending(true);
                    try {
                      await onOk?.();
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  {busy && <LoaderCircle className="size-4 animate-spin" />}
                  {okText}
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Popconfirm({
  children,
  title,
  content,
  onOk,
  onCancel,
  disabled,
  position,
  okText = "确定",
  cancelText = "取消",
}: {
  children: ReactNode;
  title?: ReactNode;
  content: ReactNode;
  onOk?: () => void | Promise<unknown>;
  onCancel?: () => void;
  disabled?: boolean;
  position?: "top" | "bottom" | "tl" | "tr" | "bl" | "br";
  okText?: string;
  cancelText?: string;
  okButtonProps?: { status?: string };
  popupVisible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Popover
      disabled={disabled}
      position={position}
      popupVisible={open}
      onVisibleChange={(next) => {
        if (!busy) setOpen(next);
      }}
      title={title}
      content={
        <>
          <div className="text-sm">{content}</div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onCancel?.();
              }}
            >
              {cancelText}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onOk?.();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {okText}
            </Button>
          </div>
        </>
      }
    >
      {children}
    </Popover>
  );
}

export function Drawer({
  children,
  visible,
  title,
  onCancel,
  width = 480,
  className,
  wrapClassName,
  bodyStyle,
}: ModalProps) {
  return (
    <Sheet
      open={visible}
      onOpenChange={(open) => {
        if (!open) onCancel?.();
      }}
    >
      <SheetContent
        className={`canvas-web-theme flex flex-col ${className ?? ""} ${wrapClassName ?? ""}`}
        style={{ width, maxWidth: "95vw" }}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto" style={bodyStyle}>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

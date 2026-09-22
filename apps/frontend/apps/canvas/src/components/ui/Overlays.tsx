import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from "@repo/design-system";
import { useState, type CSSProperties, type ReactNode } from "react";

import { Popover } from "./Floating";

interface DrawerProps {
  children?: ReactNode;
  visible?: boolean;
  title?: ReactNode;
  footer?: ReactNode;
  onCancel?: () => void;
  unmountOnExit?: boolean;
  className?: string;
  wrapClassName?: string;
  bodyStyle?: CSSProperties;
  width?: number | string;
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
}: DrawerProps) {
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

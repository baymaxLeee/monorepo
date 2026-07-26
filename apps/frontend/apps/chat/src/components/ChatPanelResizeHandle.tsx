import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "shared";

export interface ChatPanelResizeHandleProps {
  edge: "left-panel" | "right-panel";
  onDrag: (deltaX: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  disabled?: boolean;
  value: number;
  minValue?: number;
  maxValue?: number;
}

export function ChatPanelResizeHandle({
  edge,
  onDrag,
  onDragStart,
  onDragEnd,
  disabled,
  value,
  minValue,
  maxValue,
}: ChatPanelResizeHandleProps) {
  const draggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const lastClientXRef = useRef(0);
  const bodyStyleRef = useRef({ cursor: "", userSelect: "" });
  const [dragging, setDragging] = useState(false);

  const restoreBody = useCallback(() => {
    document.body.style.cursor = bodyStyleRef.current.cursor;
    document.body.style.userSelect = bodyStyleRef.current.userSelect;
  }, []);

  const finishDrag = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    pointerIdRef.current = null;
    setDragging(false);
    restoreBody();
    onDragEnd();
  }, [onDragEnd, restoreBody]);

  useEffect(
    () => () => {
      if (draggingRef.current) {
        restoreBody();
      }
    },
    [restoreBody],
  );

  if (disabled) {
    return null;
  }

  const label = edge === "left-panel" ? "调整会话列表宽度" : "调整预览区宽度";
  const isLeft = edge === "left-panel";

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={minValue ?? Math.round(value * 0.1)}
      aria-valuemax={maxValue ?? Math.round(value * 2)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className={cn(
        "absolute inset-y-0 z-50 flex w-3 touch-none select-none items-stretch justify-center",
        isLeft ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
        "cursor-col-resize outline-none",
        "hover:[&>span]:w-0.5 hover:[&>span]:bg-foreground/35",
        "focus-visible:[&>span]:w-0.5 focus-visible:[&>span]:bg-ring",
      )}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        onDragStart();
        onDrag(event.key === "ArrowLeft" ? -16 : 16);
        onDragEnd();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        draggingRef.current = true;
        pointerIdRef.current = event.pointerId;
        lastClientXRef.current = event.clientX;
        bodyStyleRef.current = {
          cursor: document.body.style.cursor,
          userSelect: document.body.style.userSelect,
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        setDragging(true);
        onDragStart();

        const onMove = (moveEvent: PointerEvent) => {
          if (!draggingRef.current || pointerIdRef.current !== moveEvent.pointerId) {
            return;
          }
          moveEvent.preventDefault();
          const deltaX = moveEvent.clientX - lastClientXRef.current;
          lastClientXRef.current = moveEvent.clientX;
          onDrag(deltaX);
        };

        const onUp = (upEvent: PointerEvent) => {
          if (pointerIdRef.current !== upEvent.pointerId) {
            return;
          }
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
          finishDrag();
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none my-0 h-full w-px shrink-0 bg-border/80 transition-all duration-150",
          dragging && "w-0.5 bg-foreground/40",
        )}
      />
    </div>
  );
}

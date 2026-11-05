import { cn } from "@repo/shared";
import { useEffect, useRef, useState } from "react";

export interface ChatPanelResizeHandleProps {
  edge: "left-panel" | "right-panel";
  onDrag: (deltaX: number) => number | void;
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
  const stopDragRef = useRef<((commitPending: boolean) => void) | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(
    () => () => {
      stopDragRef.current?.(false);
    },
    [disabled],
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
        "absolute inset-y-0 z-50 flex w-1 touch-none select-none items-stretch justify-center",
        isLeft ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
        "cursor-col-resize outline-none",
        "hover:[&>span]:w-0.5 hover:[&>span]:bg-primary",
        "focus-visible:[&>span]:w-0.5 focus-visible:[&>span]:bg-primary",
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
        if (event.button !== 0 || stopDragRef.current) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget;
        const pointerId = event.pointerId;
        target.setPointerCapture(pointerId);
        let lastClientX = event.clientX;
        let pendingDelta = 0;
        let frame: number | null = null;
        const bodyStyle = {
          cursor: document.body.style.cursor,
          userSelect: document.body.style.userSelect,
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        setDragging(true);
        onDragStart();

        const flush = () => {
          frame = null;
          const delta = pendingDelta;
          pendingDelta = 0;
          if (delta !== 0) {
            const width = onDrag(delta);
            if (typeof width === "number") target.setAttribute("aria-valuenow", String(Math.round(width)));
          }
        };

        const onMove = (moveEvent: PointerEvent) => {
          if (pointerId !== moveEvent.pointerId) {
            return;
          }
          moveEvent.preventDefault();
          pendingDelta += moveEvent.clientX - lastClientX;
          lastClientX = moveEvent.clientX;
          // Pointer input may outpace painting. Resize the transcript at most once per frame.
          if (frame === null) frame = window.requestAnimationFrame(flush);
        };

        const onUp = (upEvent: PointerEvent) => {
          if (pointerId !== upEvent.pointerId) {
            return;
          }
          finish(true);
        };

        const onInterrupted = () => finish(true);
        const finish = (commitPending: boolean) => {
          if (stopDragRef.current !== finish) return;
          stopDragRef.current = null;
          if (frame !== null) window.cancelAnimationFrame(frame);
          // Commit the last frame before the shell persists its width; discard it on unmount/disable.
          if (commitPending) flush();
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
          window.removeEventListener("blur", onInterrupted);
          target.removeEventListener("lostpointercapture", onInterrupted);
          if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
          document.body.style.cursor = bodyStyle.cursor;
          document.body.style.userSelect = bodyStyle.userSelect;
          setDragging(false);
          onDragEnd();
        };

        stopDragRef.current = finish;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        window.addEventListener("blur", onInterrupted);
        target.addEventListener("lostpointercapture", onInterrupted);
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none my-0 h-full w-px shrink-0 bg-border/80 transition-[width,background-color] duration-150",
          dragging && "w-0.5 bg-primary",
        )}
      />
    </div>
  );
}

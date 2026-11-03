import { MessageScrollerViewport, useMessageScroller } from "@repo/design-system/shadcn/message-scroller";
import { useRef, type ReactNode } from "react";

export function ConversationViewport({ className, children }: { className?: string; children: ReactNode }) {
  const { scrollToEnd } = useMessageScroller();
  const touchY = useRef<number | undefined>(undefined);

  // @shadcn/react 0.3.1 clears following on every wheel/key/touch intent, even
  // when already at the bottom and no native scroll event can restore it.
  function resumeAtBottom(viewport: HTMLDivElement) {
    if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 1) {
      scrollToEnd({ behavior: "auto" });
    }
  }

  return (
    <MessageScrollerViewport
      className={className}
      onWheel={(event) => {
        if (!event.defaultPrevented && event.deltaY > 0) resumeAtBottom(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.target !== event.currentTarget) return;
        if (event.key === "End") {
          event.preventDefault();
          scrollToEnd({ behavior: "auto" });
          return;
        }
        if (event.key === "ArrowDown" || event.key === "PageDown" || (event.key === " " && !event.shiftKey))
          resumeAtBottom(event.currentTarget);
      }}
      onTouchStart={(event) => {
        touchY.current = event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
      }}
      onTouchMove={(event) => {
        const nextY = event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
        const previousY = touchY.current;
        touchY.current = nextY;
        if (!event.defaultPrevented && nextY !== undefined && previousY !== undefined && nextY < previousY) {
          resumeAtBottom(event.currentTarget);
        }
      }}
      onTouchEnd={() => {
        touchY.current = undefined;
      }}
      onTouchCancel={() => {
        touchY.current = undefined;
      }}
    >
      {children}
    </MessageScrollerViewport>
  );
}

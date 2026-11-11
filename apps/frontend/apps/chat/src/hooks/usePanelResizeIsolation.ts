import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from "react";

const ISOLATED_CONTENT_SELECTOR = "[data-chat-panel-resize-isolate]";
const RESIZE_HANDLE_SELECTOR = '[data-slot="resizable-handle"], [data-separator]';

type FrozenContent = {
  element: HTMLElement;
  height: number;
  width: number;
};

/**
 * Keeps expensive panel contents at their pointer-down viewport while the
 * lightweight panel shells resize. Markdown editors and HTML iframes then do
 * one layout on release instead of relaying out for every pointer event.
 */
export function usePanelResizeIsolation() {
  const groupRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const listenerDocumentRef = useRef<Document | null>(null);

  const finishResize = useCallback((event?: Event) => {
    const eventPointerId = event && "pointerId" in event ? event.pointerId : null;
    if (
      typeof eventPointerId === "number" &&
      activePointerIdRef.current !== null &&
      eventPointerId !== activePointerIdRef.current
    ) {
      return;
    }

    const root = groupRef.current;
    if (root) {
      delete root.dataset.panelResizeActive;
      for (const element of root.querySelectorAll<HTMLElement>(ISOLATED_CONTENT_SELECTOR)) {
        if (element.dataset.chatPanelResizeFrozen !== "true") continue;
        delete element.dataset.chatPanelResizeFrozen;
        element.style.removeProperty("contain");
        element.style.removeProperty("height");
        element.style.removeProperty("inset-block-start");
        element.style.removeProperty("inset-inline-end");
        element.style.removeProperty("inset-inline-start");
        element.style.removeProperty("position");
        element.style.removeProperty("width");
      }
    }

    activePointerIdRef.current = null;
    const listenerDocument = listenerDocumentRef.current;
    listenerDocumentRef.current = null;
    listenerDocument?.removeEventListener("pointerup", finishResize, true);
    listenerDocument?.removeEventListener("pointercancel", finishResize, true);
    listenerDocument?.defaultView?.removeEventListener("blur", finishResize);
  }, []);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || activePointerIdRef.current !== null) return;
      const target = event.target;
      const root = groupRef.current;
      if (!(target instanceof Element) || !root) return;
      const handle = target.closest(RESIZE_HANDLE_SELECTOR);
      if (!handle || !root.contains(handle)) return;

      // Read every box before writing styles so pointer-down causes at most one
      // layout pass rather than alternating layout reads and invalidations.
      const frozenContents: FrozenContent[] = [...root.querySelectorAll<HTMLElement>(ISOLATED_CONTENT_SELECTOR)].map(
        (element) => {
          const rect = element.getBoundingClientRect();
          return { element, height: rect.height, width: rect.width };
        },
      );

      root.dataset.panelResizeActive = "true";
      activePointerIdRef.current = event.pointerId;
      for (const { element, height, width } of frozenContents) {
        const anchor = element.dataset.chatPanelResizeIsolate;
        element.dataset.chatPanelResizeFrozen = "true";
        element.style.contain = "strict";
        element.style.height = `${height}px`;
        element.style.position = "absolute";
        element.style.insetBlockStart = "0px";
        element.style.width = `${width}px`;
        if (anchor === "end") element.style.insetInlineEnd = "0px";
        else element.style.insetInlineStart = "0px";
      }

      const listenerDocument = root.ownerDocument;
      listenerDocumentRef.current = listenerDocument;
      listenerDocument.addEventListener("pointerup", finishResize, true);
      listenerDocument.addEventListener("pointercancel", finishResize, true);
      listenerDocument.defaultView?.addEventListener("blur", finishResize);
    },
    [finishResize],
  );

  useEffect(() => finishResize, [finishResize]);

  return { groupRef, startResize };
}

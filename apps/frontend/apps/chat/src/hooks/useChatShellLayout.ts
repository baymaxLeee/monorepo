import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  clamp,
  isCompactLayout,
  panelLimits,
  persistWidth,
  readStoredWidth,
  resolvePanelWidth,
} from "./chat-shell-widths";

type PanelEdge = "left-panel" | "right-panel";

export type ChatShellLayout = {
  containerRef: RefObject<HTMLDivElement | null>;
  leftPanelRef: RefObject<HTMLElement | null>;
  rightPanelRef: RefObject<HTMLDivElement | null>;
  leftWidth: number;
  panelLeftWidth: number;
  rightWidth: number;
  panelRightWidth: number;
  leftOpen: boolean;
  compact: boolean;
  isDragging: boolean;
  leftResizeMin: number;
  leftResizeMax: number;
  rightResizeMin: number;
  rightResizeMax: number;
  toggleLeft: () => void;
  closeArtifact: () => void;
  resizeLeft: (deltaX: number) => number | undefined;
  resizeRight: (deltaX: number) => number | undefined;
  startResize: (edge: PanelEdge) => void;
  endResize: (edge: PanelEdge) => void;
};

export function useChatShellLayout(artifactOpen: boolean, onCloseArtifact: () => void): ChatShellLayout {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const containerWidthRef = useRef(0);
  const leftWidthRef = useRef(0);
  const rightWidthRef = useRef(0);
  const leftDragWidthRef = useRef(0);
  const rightDragWidthRef = useRef(0);
  const pendingCollapseRef = useRef<PanelEdge | null>(null);
  const artifactOpenRef = useRef(artifactOpen);
  const leftOpenRef = useRef(true);
  const initializedRef = useRef(false);
  const prevArtifactOpenRef = useRef(artifactOpen);
  const [leftWidth, setLeftWidth] = useState(0);
  const [rightWidth, setRightWidth] = useState(0);
  const [leftOpen, setLeftOpen] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // These styles have a single imperative owner. Drag frames never render the shell,
  // its conversation list, editors or menus; React receives the final width on release.
  const applyWidths = useCallback((left: number, right: number) => {
    const compact = isCompactLayout(containerWidthRef.current, artifactOpenRef.current);
    const visibleLeft = leftOpenRef.current ? left : 0;
    const visibleRight = artifactOpenRef.current ? right : 0;
    if (containerRef.current) {
      containerRef.current.style.gridTemplateColumns = compact
        ? "0px minmax(0, 1fr) 0px"
        : `${visibleLeft}px minmax(0, 1fr) ${visibleRight}px`;
    }
    if (leftPanelRef.current) leftPanelRef.current.style.width = compact ? `${visibleLeft}px` : "";
    if (rightPanelRef.current) {
      rightPanelRef.current.style.width = compact ? `min(${visibleRight}px, calc(100% - 3rem))` : "";
    }
  }, []);

  useLayoutEffect(() => {
    artifactOpenRef.current = artifactOpen;
    leftOpenRef.current = leftOpen;
    applyWidths(
      isDragging ? Math.max(0, leftDragWidthRef.current) : leftWidth,
      isDragging ? Math.max(0, rightDragWidthRef.current) : rightWidth,
    );
  }, [applyWidths, artifactOpen, containerWidth, isDragging, leftOpen, leftWidth, rightWidth]);

  const maxLeftWidth = useCallback(() => {
    const w = containerWidthRef.current;
    if (w <= 0) {
      return 0;
    }
    const limits = panelLimits(w);
    const occupiedRight = artifactOpenRef.current ? rightWidthRef.current : 0;
    return Math.max(limits.leftCollapse, Math.min(limits.leftMax, w - limits.minMain - occupiedRight));
  }, []);

  const maxRightWidth = useCallback(() => {
    const w = containerWidthRef.current;
    if (w <= 0) {
      return 0;
    }
    const limits = panelLimits(w);
    const occupiedLeft = leftOpenRef.current ? leftWidthRef.current : 0;
    return Math.max(limits.rightCollapse, Math.min(limits.rightMax, w - limits.minMain - occupiedLeft));
  }, []);

  const collapseLeft = useCallback(() => {
    leftOpenRef.current = false;
    setLeftOpen(false);
    setLeftWidth(0);
    pendingCollapseRef.current = null;
  }, []);

  const collapseRight = useCallback(() => {
    onCloseArtifact();
    setRightWidth(0);
    pendingCollapseRef.current = null;
  }, [onCloseArtifact]);

  useLayoutEffect(() => {
    const w = containerWidth;
    if (w <= 0) {
      return;
    }

    const limits = panelLimits(w);

    if (!initializedRef.current) {
      initializedRef.current = true;
      const nextLeft = resolvePanelWidth(
        readStoredWidth("chat:left-width"),
        limits.leftDefault,
        limits.leftCollapse,
        Math.min(limits.leftMax, w - limits.minMain),
      );
      const nextRight = resolvePanelWidth(
        readStoredWidth("chat:right-width"),
        limits.rightDefault,
        limits.rightCollapse,
        limits.rightMax,
      );
      leftWidthRef.current = nextLeft;
      rightWidthRef.current = nextRight;
      leftDragWidthRef.current = nextLeft;
      rightDragWidthRef.current = nextRight;
      setLeftWidth(nextLeft);
      setRightWidth(nextRight);
      return;
    }

    if (artifactOpen && !prevArtifactOpenRef.current) {
      const preferred = resolvePanelWidth(
        readStoredWidth("chat:right-width"),
        rightWidthRef.current > limits.rightCollapse ? rightWidthRef.current : limits.rightDefault,
        limits.rightCollapse,
        maxRightWidth(),
      );
      rightWidthRef.current = preferred;
      rightDragWidthRef.current = preferred;
      setRightWidth(preferred);
    }
    prevArtifactOpenRef.current = artifactOpen;

    if (leftOpenRef.current && leftWidthRef.current > 0) {
      const nextLeft = clamp(leftWidthRef.current, 0, maxLeftWidth());
      if (nextLeft < limits.leftCollapse) {
        collapseLeft();
      } else if (nextLeft !== leftWidthRef.current) {
        leftWidthRef.current = nextLeft;
        leftDragWidthRef.current = nextLeft;
        setLeftWidth(nextLeft);
      }
    }

    if (artifactOpen && rightWidthRef.current > 0) {
      const nextRight = clamp(rightWidthRef.current, 0, maxRightWidth());
      if (nextRight < limits.rightCollapse) {
        collapseRight();
      } else if (nextRight !== rightWidthRef.current) {
        rightWidthRef.current = nextRight;
        rightDragWidthRef.current = nextRight;
        setRightWidth(nextRight);
      }
    }
  }, [artifactOpen, collapseLeft, collapseRight, containerWidth, leftOpen, maxLeftWidth, maxRightWidth]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const update = (width: number) => {
      containerWidthRef.current = width;
      setContainerWidth(Math.round(width));
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        update(entry.contentRect.width);
      }
    });
    observer.observe(node);
    update(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const resizeLeft = useCallback(
    (deltaX: number) => {
      const w = containerWidthRef.current;
      if (w <= 0) {
        return;
      }
      const limits = panelLimits(w);
      const raw = leftDragWidthRef.current + deltaX;
      leftDragWidthRef.current = raw;

      if (raw < limits.leftCollapse) {
        pendingCollapseRef.current = "left-panel";
        const next = Math.max(0, raw);
        applyWidths(next, rightWidthRef.current);
        return next;
      }

      pendingCollapseRef.current = null;
      const next = clamp(raw, limits.leftCollapse, maxLeftWidth());
      leftWidthRef.current = next;
      leftDragWidthRef.current = next;
      applyWidths(next, rightWidthRef.current);
      return next;
    },
    [applyWidths, maxLeftWidth],
  );

  const resizeRight = useCallback(
    (deltaX: number) => {
      const w = containerWidthRef.current;
      if (w <= 0) {
        return;
      }
      const limits = panelLimits(w);
      const raw = rightDragWidthRef.current - deltaX;
      rightDragWidthRef.current = raw;

      if (raw < limits.rightCollapse) {
        pendingCollapseRef.current = "right-panel";
        const next = Math.max(0, raw);
        applyWidths(leftWidthRef.current, next);
        return next;
      }

      pendingCollapseRef.current = null;
      const next = clamp(raw, limits.rightCollapse, maxRightWidth());
      rightWidthRef.current = next;
      rightDragWidthRef.current = next;
      applyWidths(leftWidthRef.current, next);
      return next;
    },
    [applyWidths, maxRightWidth],
  );

  const startResize = useCallback((edge: PanelEdge) => {
    pendingCollapseRef.current = null;
    setIsDragging(true);
    if (edge === "left-panel") {
      const w = containerWidthRef.current;
      const limits = panelLimits(w);
      leftOpenRef.current = true;
      setLeftOpen(true);
      if (leftWidthRef.current < limits.leftCollapse) {
        leftWidthRef.current = limits.leftDefault;
      }
      leftDragWidthRef.current = leftWidthRef.current;
      setLeftWidth(leftWidthRef.current);
    } else {
      rightDragWidthRef.current = rightWidthRef.current;
    }
  }, []);

  const endResize = useCallback(
    (edge: PanelEdge) => {
      setIsDragging(false);

      if (pendingCollapseRef.current === edge) {
        if (edge === "left-panel") {
          collapseLeft();
        } else {
          collapseRight();
        }
        return;
      }

      if (edge === "left-panel") {
        setLeftWidth(leftWidthRef.current);
        persistWidth("chat:left-width", leftWidthRef.current);
      } else {
        setRightWidth(rightWidthRef.current);
        persistWidth("chat:right-width", rightWidthRef.current);
      }
    },
    [collapseLeft, collapseRight],
  );

  const toggleLeft = useCallback(() => {
    const w = containerWidthRef.current;
    const limits = panelLimits(w);

    setLeftOpen((open) => {
      const next = !open;
      leftOpenRef.current = next;
      if (next) {
        const width = resolvePanelWidth(
          readStoredWidth("chat:left-width"),
          leftWidthRef.current >= limits.leftCollapse ? leftWidthRef.current : limits.leftDefault,
          limits.leftCollapse,
          maxLeftWidth(),
        );
        leftWidthRef.current = width;
        leftDragWidthRef.current = width;
        setLeftWidth(width);
      } else {
        setLeftWidth(0);
      }
      return next;
    });
  }, []);

  const compact = isCompactLayout(containerWidth, artifactOpen);

  const limits = containerWidth > 0 ? panelLimits(containerWidth) : null;

  return {
    containerRef,
    leftPanelRef,
    rightPanelRef,
    leftWidth: leftOpen ? leftWidth : 0,
    panelLeftWidth: leftWidth,
    rightWidth: artifactOpen ? rightWidth : 0,
    panelRightWidth: rightWidth,
    leftOpen,
    compact,
    isDragging,
    leftResizeMin: limits?.leftCollapse ?? 0,
    leftResizeMax: limits ? maxLeftWidth() : 0,
    rightResizeMin: limits?.rightCollapse ?? 0,
    rightResizeMax: limits ? maxRightWidth() : 0,
    toggleLeft,
    closeArtifact: onCloseArtifact,
    resizeLeft,
    resizeRight,
    startResize,
    endResize,
  };
}

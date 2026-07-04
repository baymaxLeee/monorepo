import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const LEFT_DEFAULT_FRACTION = 0.15;
const LEFT_MAX_FRACTION = 0.2;
const RIGHT_DEFAULT_FRACTION = 0.4;
const RIGHT_MAX_FRACTION = 0.8;
const COLLAPSE_FRACTION = 0.1;
const MIN_MAIN_FRACTION = 0.25;
const MIN_MAIN_WIDTH_PX = 320;
const COMPACT_BREAKPOINT = 640;

type PanelEdge = "left-panel" | "right-panel";

export type ChatShellLayout = {
  containerRef: RefObject<HTMLDivElement>;
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
  resizeLeft: (deltaX: number) => void;
  resizeRight: (deltaX: number) => void;
  startResize: (edge: PanelEdge) => void;
  endResize: (edge: PanelEdge) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function panelLimits(containerWidth: number) {
  const w = containerWidth;
  return {
    leftDefault: w * LEFT_DEFAULT_FRACTION,
    leftMax: w * LEFT_MAX_FRACTION,
    leftCollapse: w * COLLAPSE_FRACTION,
    rightDefault: w * RIGHT_DEFAULT_FRACTION,
    rightMax: w * RIGHT_MAX_FRACTION,
    rightCollapse: w * COLLAPSE_FRACTION,
    minMain: Math.max(w * MIN_MAIN_FRACTION, MIN_MAIN_WIDTH_PX),
  };
}

function readStoredWidth(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function persistWidth(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {}
}

function resolvePanelWidth(
  stored: number | null,
  fallback: number,
  collapse: number,
  max: number,
) {
  const preferred = stored ?? fallback;
  return clamp(preferred, collapse, Math.max(collapse, max));
}

export function useChatShellLayout(
  artifactOpen: boolean,
  onCloseArtifact: () => void,
): ChatShellLayout {
  const containerRef = useRef<HTMLDivElement>(null);
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

  const maxLeftWidth = useCallback(() => {
    const w = containerWidthRef.current;
    if (w <= 0) return 0;
    const limits = panelLimits(w);
    const occupiedRight = artifactOpenRef.current ? rightWidthRef.current : 0;
    return Math.max(
      limits.leftCollapse,
      Math.min(limits.leftMax, w - limits.minMain - occupiedRight),
    );
  }, []);

  const maxRightWidth = useCallback(() => {
    const w = containerWidthRef.current;
    if (w <= 0) return 0;
    const limits = panelLimits(w);
    const occupiedLeft = leftOpenRef.current ? leftWidthRef.current : 0;
    return Math.max(
      limits.rightCollapse,
      Math.min(limits.rightMax, w - limits.minMain - occupiedLeft),
    );
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
    artifactOpenRef.current = artifactOpen;
    leftOpenRef.current = leftOpen;
  }, [artifactOpen, leftOpen]);

  useLayoutEffect(() => {
    const w = containerWidth;
    if (w <= 0) return;

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
        rightWidthRef.current > limits.rightCollapse
          ? rightWidthRef.current
          : limits.rightDefault,
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
  }, [
    artifactOpen,
    collapseLeft,
    collapseRight,
    containerWidth,
    leftOpen,
    maxLeftWidth,
    maxRightWidth,
  ]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = (width: number) => {
      containerWidthRef.current = width;
      setContainerWidth(Math.round(width));
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(node);
    update(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const resizeLeft = useCallback(
    (deltaX: number) => {
      const w = containerWidthRef.current;
      if (w <= 0) return;
      const limits = panelLimits(w);
      const raw = leftDragWidthRef.current + deltaX;
      leftDragWidthRef.current = raw;

      if (raw < limits.leftCollapse) {
        pendingCollapseRef.current = "left-panel";
        setLeftWidth(Math.max(0, raw));
        return;
      }

      pendingCollapseRef.current = null;
      const next = clamp(raw, limits.leftCollapse, maxLeftWidth());
      leftWidthRef.current = next;
      leftDragWidthRef.current = next;
      setLeftWidth(next);
    },
    [maxLeftWidth],
  );

  const resizeRight = useCallback(
    (deltaX: number) => {
      const w = containerWidthRef.current;
      if (w <= 0) return;
      const limits = panelLimits(w);
      const raw = rightDragWidthRef.current - deltaX;
      rightDragWidthRef.current = raw;

      if (raw < limits.rightCollapse) {
        pendingCollapseRef.current = "right-panel";
        setRightWidth(Math.max(0, raw));
        return;
      }

      pendingCollapseRef.current = null;
      const next = clamp(raw, limits.rightCollapse, maxRightWidth());
      rightWidthRef.current = next;
      rightDragWidthRef.current = next;
      setRightWidth(next);
    },
    [maxRightWidth],
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
        if (edge === "left-panel") collapseLeft();
        else collapseRight();
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
          leftWidthRef.current >= limits.leftCollapse
            ? leftWidthRef.current
            : limits.leftDefault,
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

  const compact =
    containerWidth > 0 &&
    containerWidth <
      (artifactOpen
        ? panelLimits(containerWidth).minMain +
          panelLimits(containerWidth).leftCollapse +
          panelLimits(containerWidth).rightCollapse
        : COMPACT_BREAKPOINT);

  const limits = containerWidth > 0 ? panelLimits(containerWidth) : null;

  return {
    containerRef,
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

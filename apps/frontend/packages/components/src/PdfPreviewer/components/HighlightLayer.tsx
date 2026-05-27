import { forwardRef, useImperativeHandle, useMemo } from "react";

import { cn } from "shared";
import type {
  PdfHighlight,
  PdfHighlightRegions,
  PdfSelectionRegion,
} from "../interface";

export interface HighlightLayerProps {
  /** 当前正在展示的页码（1-based） */
  pageNumber: number;
  /** highlights 全集（含其他形态），由 layer 内部按 regions + pageIndex 过滤 */
  highlights: PdfHighlight[];
  /** 点击高亮块回调，会回传原始 highlight 对象与其在 props.highlights 中的下标 */
  onHighlightClick?: (payload: {
    highlight: PdfHighlight;
    index: number;
    event: MouseEvent;
  }) => void;
}

export interface HighlightLayerRef {
  /** 通过 id 查到对应块 DOM */
  getHighlightElement: (id: string) => HTMLElement | null;
}

const isRegionsHighlight = (
  highlight: PdfHighlight,
): highlight is PdfHighlightRegions =>
  Array.isArray((highlight as PdfHighlightRegions).regions);

interface RenderItem {
  key: string;
  id: string | undefined;
  index: number;
  className: string | undefined;
  /** 业务显式传入的色；undefined 时使用默认底色 */
  color: string | undefined;
  region: PdfSelectionRegion;
  highlight: PdfHighlight;
}

const DEFAULT_HIGHLIGHT_COLOR = "rgb(250 204 21 / 35%)";

const HighlightLayer = forwardRef<HighlightLayerRef, HighlightLayerProps>(
  ({ pageNumber, highlights, onHighlightClick }, ref) => {
    const renderItems = useMemo<RenderItem[]>(() => {
      const items: RenderItem[] = [];
      highlights.forEach((highlight, index) => {
        if (!isRegionsHighlight(highlight)) return;
        highlight.regions.forEach((region, subIndex) => {
          if (region.pageIndex + 1 !== pageNumber) return;
          if (region.width <= 0 || region.height <= 0) return;
          items.push({
            key: `${highlight.id ?? `h-${index}`}-${subIndex}`,
            id: highlight.id,
            index,
            className: highlight.className,
            color: highlight.color,
            region,
            highlight,
          });
        });
      });
      return items;
    }, [highlights, pageNumber]);

    useImperativeHandle(
      ref,
      () => ({
        getHighlightElement: (id: string) => {
          if (typeof document === "undefined" || !id) return null;
          return document.querySelector<HTMLElement>(
            `[data-pdf-highlight="region"][data-highlight-id="${id}"]`,
          );
        },
      }),
      [],
    );

    if (renderItems.length === 0) {
      return null;
    }

    return (
      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        data-testid="pdf-highlight-layer"
      >
        {renderItems.map((item) => (
          <div
            key={item.key}
            data-pdf-highlight="region"
            data-highlight-id={item.id ?? ""}
            data-highlight-index={item.index}
            className={cn("absolute rounded-sm", item.className)}
            style={{
              left: `${item.region.left}%`,
              top: `${item.region.top}%`,
              width: `${item.region.width}%`,
              height: `${item.region.height}%`,
              background: item.color ?? DEFAULT_HIGHLIGHT_COLOR,
              pointerEvents: onHighlightClick ? "auto" : "none",
              cursor: onHighlightClick ? "pointer" : undefined,
            }}
            onClick={(event) => {
              onHighlightClick?.({
                highlight: item.highlight,
                index: item.index,
                event: event.nativeEvent,
              });
            }}
          />
        ))}
      </div>
    );
  },
);

HighlightLayer.displayName = "PdfHighlightLayer";

export default HighlightLayer;

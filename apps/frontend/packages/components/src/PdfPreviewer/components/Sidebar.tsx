import { cn } from "shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Outline, Thumbnail } from "react-pdf";
import { slotClassNameFactory } from "../../compat/className";
import type { PdfSidebarType } from "../interface";

const cssPrefix = slotClassNameFactory("pdf-previewer");

interface OnItemClickPayload {
  pageNumber: number;
}

export interface SidebarProps {
  sidebarType: PdfSidebarType;
  numPages: number;
  currentPage: number;
  width: number;
  thumbnailWidth?: number;
  onJumpPage: (pageNumber: number) => void;
}

const Sidebar = ({
  sidebarType,
  numPages,
  currentPage,
  onJumpPage,
  width,
  thumbnailWidth = width * 0.8,
}: SidebarProps) => {
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const thumbnailListRef = useRef<HTMLDivElement | null>(null);
  const thumbnailScrollRafRef = useRef<number | null>(null);
  const [outlineEmpty, setOutlineEmpty] = useState(false);

  const pageNumbers = useMemo(
    () =>
      Array.from({ length: Math.max(0, numPages) }, (_, index) => index + 1),
    [numPages],
  );

  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  const scrollThumbnailIntoView = (
    pageNumber: number,
    behavior: ScrollBehavior = "smooth",
  ) => {
    const listEl = thumbnailListRef.current;
    const element = itemRefs.current[pageNumber];
    if (!listEl || !element) return;

    const listRect = listEl.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const elementTop = elementRect.top - listRect.top + listEl.scrollTop;

    const nextTop =
      elementTop - Math.max(0, (listEl.clientHeight - elementRect.height) / 2);
    listEl.scrollTo({
      top: Math.max(0, nextTop),
      behavior,
    });
  };

  const requestThumbnailScroll = (
    pageNumber: number,
    behavior: ScrollBehavior = "smooth",
  ) => {
    if (thumbnailScrollRafRef.current !== null) {
      window.cancelAnimationFrame(thumbnailScrollRafRef.current);
    }
    thumbnailScrollRafRef.current = window.requestAnimationFrame(() => {
      thumbnailScrollRafRef.current = null;
      scrollThumbnailIntoView(pageNumber, behavior);
    });
  };

  useEffect(() => {
    if (sidebarType !== "thumbnail" || !numPages) return;
    requestThumbnailScroll(currentPage);
  }, [sidebarType, numPages, currentPage]);

  useEffect(() => {
    return () => {
      if (thumbnailScrollRafRef.current !== null) {
        window.cancelAnimationFrame(thumbnailScrollRafRef.current);
      }
    };
  }, []);

  const handleItemClick = (payload: OnItemClickPayload) => {
    if (typeof payload?.pageNumber === "number") {
      onJumpPage(payload.pageNumber);
    }
  };

  if (sidebarType === null) return null;

  return (
    <aside
      className={cssPrefix`sidebar`}
      data-testid="pdf-sidebar"
      data-sidebar-type={sidebarType}
      style={{ width }}
    >
      {sidebarType === "outline" ? (
        <div
          className={cn(
            cssPrefix`sidebar-panel`,
            cssPrefix`sidebar-outline`,
          )}
          data-testid="pdf-sidebar-outline"
        >
          {outlineEmpty ? (
            <div className={cssPrefix`sidebar-empty`}>暂无大纲</div>
          ) : null}
          <Outline
            onItemClick={handleItemClick}
            onLoadSuccess={(outline) => {
              setOutlineEmpty(!outline || outline.length === 0);
            }}
          />
        </div>
      ) : null}

      {sidebarType === "thumbnail" ? (
        <div
          ref={thumbnailListRef}
          className={cn(
            cssPrefix`sidebar-panel`,
            cssPrefix`sidebar-thumbnails`,
          )}
          data-testid="pdf-sidebar-thumbnails"
        >
          {pageNumbers.map((pageNumber) => {
            const isActive = pageNumber === currentPage;
            return (
              <div
                key={pageNumber}
                ref={(node) => {
                  itemRefs.current[pageNumber] = node;
                }}
                className={cn(cssPrefix`sidebar-thumbnail-item`, {
                  [cssPrefix`sidebar-thumbnail-item-active`]: isActive,
                })}
                data-page-number={pageNumber}
                data-testid={`pdf-thumbnail-item-${pageNumber}`}
                data-active={isActive ? "true" : undefined}
              >
                <div className={cssPrefix`sidebar-thumbnail-canvas`}>
                  <Thumbnail
                    pageNumber={pageNumber}
                    width={thumbnailWidth}
                    loading={null}
                    onItemClick={handleItemClick}
                    onRenderSuccess={() => {
                      if (pageNumber === currentPageRef.current) {
                        requestThumbnailScroll(pageNumber);
                      }
                    }}
                  />
                </div>
                <div className={cssPrefix`sidebar-thumbnail-label`}>
                  {pageNumber}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
};

Sidebar.displayName = "PdfSidebar";

export default Sidebar;

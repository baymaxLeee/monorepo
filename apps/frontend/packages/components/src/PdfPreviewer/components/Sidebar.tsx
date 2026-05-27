import { useEffect, useMemo, useRef, useState } from "react";
import { Outline, Thumbnail } from "react-pdf";

import { cn } from "shared";
import type { PdfSidebarType } from "../interface";

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
      className="shrink-0 overflow-auto border-r bg-background"
      data-testid="pdf-sidebar"
      data-sidebar-type={sidebarType}
      style={{ width }}
    >
      {sidebarType === "outline" ? (
        <div
          className="p-2 text-sm [&_a]:block [&_a]:rounded-sm [&_a]:px-2 [&_a]:py-1 [&_a]:text-muted-foreground [&_a:hover]:bg-accent [&_a:hover]:text-accent-foreground [&_ul]:list-none [&_ul]:pl-3 [&_ul]:m-0 [&_ul]:p-0 [&_ul_ul]:pl-3"
          data-testid="pdf-sidebar-outline"
        >
          {outlineEmpty ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              暂无大纲
            </div>
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
          className="flex h-full flex-col items-center gap-2 p-2"
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
                className={cn(
                  "flex w-full cursor-pointer flex-col items-center gap-1 rounded-md p-1.5 transition-colors hover:bg-accent",
                  isActive && "bg-accent",
                )}
                data-page-number={pageNumber}
                data-testid={`pdf-thumbnail-item-${pageNumber}`}
                data-active={isActive ? "true" : undefined}
              >
                <div
                  className={cn(
                    "overflow-hidden rounded-sm border bg-background shadow-sm",
                    isActive && "border-primary ring-1 ring-primary/40",
                  )}
                >
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
                <div
                  className={cn(
                    "text-xs text-muted-foreground",
                    isActive && "font-medium text-foreground",
                  )}
                >
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

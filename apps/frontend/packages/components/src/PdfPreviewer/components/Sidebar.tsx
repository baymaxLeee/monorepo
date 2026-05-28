import {
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Thumbnail } from "react-pdf";

import { cn } from "shared";
import type { PdfSidebarType } from "../interface";

interface OnItemClickPayload {
  pageNumber: number;
}

interface PdfDocumentLike {
  getOutline?: () => Promise<unknown[] | null>;
  getDestination?: (destination: string) => Promise<unknown[] | null>;
  getPageIndex?: (ref: unknown) => Promise<number>;
}

interface RawOutlineItem {
  title?: unknown;
  dest?: unknown;
  items?: unknown;
}

interface OutlineItem {
  key: string;
  title: string;
  pageNumber: number | null;
  children: OutlineItem[];
}

export interface SidebarProps {
  sidebarType: PdfSidebarType;
  numPages: number;
  currentPage: number;
  width: number;
  pdf?: PdfDocumentLike | null;
  thumbnailWidth?: number;
  onJumpPage: (pageNumber: number) => void;
}

function isRawOutlineItem(value: unknown): value is RawOutlineItem {
  return Boolean(value && typeof value === "object");
}

async function resolveOutlinePage(
  pdf: PdfDocumentLike,
  dest: unknown,
): Promise<number | null> {
  if (!pdf.getPageIndex) return null;
  const destination =
    typeof dest === "string" && pdf.getDestination
      ? await pdf.getDestination(dest)
      : dest;

  if (!Array.isArray(destination) || !destination.length) return null;

  try {
    const pageIndex = await pdf.getPageIndex(destination[0]);
    return Number.isFinite(pageIndex) ? pageIndex + 1 : null;
  } catch {
    return null;
  }
}

async function resolveOutlineItems(
  pdf: PdfDocumentLike,
  items: unknown[],
  parentKey = "",
): Promise<OutlineItem[]> {
  return Promise.all(
    items.filter(isRawOutlineItem).map(async (item, index) => {
      const key = parentKey ? `${parentKey}-${index}` : String(index);
      const children = Array.isArray(item.items)
        ? await resolveOutlineItems(pdf, item.items, key)
        : [];

      return {
        key,
        title: typeof item.title === "string" ? item.title : "未命名大纲",
        pageNumber: await resolveOutlinePage(pdf, item.dest),
        children,
      };
    }),
  );
}

function flattenOutline(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap((item) => [item, ...flattenOutline(item.children)]);
}

function getActiveOutlineKey(
  items: OutlineItem[],
  currentPage: number,
): string | null {
  let active: OutlineItem | null = null;
  for (const item of flattenOutline(items)) {
    if (!item.pageNumber || item.pageNumber > currentPage) continue;
    if (!active || item.pageNumber >= (active.pageNumber ?? 0)) {
      active = item;
    }
  }
  return active?.key ?? null;
}

function scrollItemIntoView(
  scrollEl: HTMLElement | null,
  itemEl: HTMLElement | null,
  behavior: ScrollBehavior = "smooth",
) {
  if (!scrollEl || !itemEl) return;

  const scrollRect = scrollEl.getBoundingClientRect();
  const itemRect = itemEl.getBoundingClientRect();
  const itemTop = itemRect.top - scrollRect.top + scrollEl.scrollTop;
  const nextTop =
    itemTop - Math.max(0, (scrollEl.clientHeight - itemRect.height) / 2);

  scrollEl.scrollTo({
    top: Math.max(0, nextTop),
    behavior,
  });
}

const Sidebar = ({
  sidebarType,
  numPages,
  currentPage,
  onJumpPage,
  width,
  pdf,
  thumbnailWidth = width * 0.8,
}: SidebarProps) => {
  const thumbnailItemRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const outlineItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const thumbnailListRef = useRef<HTMLDivElement | null>(null);
  const outlineListRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollRafRef = useRef<number | null>(null);
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [outlineEmpty, setOutlineEmpty] = useState(false);

  const pageNumbers = useMemo(
    () =>
      Array.from({ length: Math.max(0, numPages) }, (_, index) => index + 1),
    [numPages],
  );

  const activeOutlineKey = useMemo(
    () => getActiveOutlineKey(outlineItems, currentPage),
    [outlineItems, currentPage],
  );

  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  const requestSidebarScroll = (
    scrollEl: HTMLElement | null,
    itemEl: HTMLElement | null,
    behavior: ScrollBehavior = "smooth",
  ) => {
    if (sidebarScrollRafRef.current !== null) {
      window.cancelAnimationFrame(sidebarScrollRafRef.current);
    }
    sidebarScrollRafRef.current = window.requestAnimationFrame(() => {
      sidebarScrollRafRef.current = null;
      scrollItemIntoView(scrollEl, itemEl, behavior);
    });
  };

  useEffect(() => {
    if (sidebarType !== "outline" || !pdf?.getOutline) {
      setOutlineItems([]);
      setOutlineEmpty(false);
      return;
    }

    let cancelled = false;

    void pdf
      .getOutline()
      .then(async (outline) => {
        if (cancelled) return;
        if (!outline?.length) {
          setOutlineItems([]);
          setOutlineEmpty(true);
          return;
        }
        const resolvedItems = await resolveOutlineItems(pdf, outline);
        if (cancelled) return;
        setOutlineItems(resolvedItems);
        setOutlineEmpty(resolvedItems.length === 0);
      })
      .catch(() => {
        if (cancelled) return;
        setOutlineItems([]);
        setOutlineEmpty(true);
      });

    return () => {
      cancelled = true;
    };
  }, [sidebarType, pdf]);

  useEffect(() => {
    if (sidebarType !== "thumbnail" || !numPages) return;
    requestSidebarScroll(
      thumbnailListRef.current,
      thumbnailItemRefs.current[currentPage],
    );
  }, [sidebarType, numPages, currentPage]);

  useEffect(() => {
    if (sidebarType !== "outline" || !activeOutlineKey) return;
    requestSidebarScroll(
      outlineListRef.current,
      outlineItemRefs.current[activeOutlineKey],
    );
  }, [sidebarType, activeOutlineKey]);

  useEffect(() => {
    return () => {
      if (sidebarScrollRafRef.current !== null) {
        window.cancelAnimationFrame(sidebarScrollRafRef.current);
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
      className="shrink-0 overflow-hidden border-r bg-background"
      data-testid="pdf-sidebar"
      data-sidebar-type={sidebarType}
      style={{ width }}
    >
      {sidebarType === "outline" ? (
        <div
          ref={outlineListRef}
          className="scrollbar-hide h-full overflow-auto p-2 text-sm"
          data-testid="pdf-sidebar-outline"
        >
          {outlineEmpty ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              暂无大纲
            </div>
          ) : (
            <OutlineTree
              items={outlineItems}
              activeKey={activeOutlineKey}
              itemRefs={outlineItemRefs}
              onJumpPage={onJumpPage}
            />
          )}
        </div>
      ) : null}

      {sidebarType === "thumbnail" ? (
        <div
          ref={thumbnailListRef}
          className="scrollbar-hide flex h-full flex-col items-center gap-2 overflow-auto p-2"
          data-testid="pdf-sidebar-thumbnails"
        >
          {pageNumbers.map((pageNumber) => {
            const isActive = pageNumber === currentPage;
            return (
              <div
                key={pageNumber}
                ref={(node) => {
                  thumbnailItemRefs.current[pageNumber] = node;
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
                        requestSidebarScroll(
                          thumbnailListRef.current,
                          thumbnailItemRefs.current[pageNumber],
                        );
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

interface OutlineTreeProps {
  items: OutlineItem[];
  activeKey: string | null;
  itemRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>;
  onJumpPage: (pageNumber: number) => void;
}

function OutlineTree({
  items,
  activeKey,
  itemRefs,
  onJumpPage,
}: OutlineTreeProps) {
  if (!items.length) return null;

  return (
    <ul className="m-0 list-none space-y-0.5 p-0">
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <li key={item.key}>
            <button
              ref={(node) => {
                itemRefs.current[item.key] = node;
              }}
              type="button"
              disabled={!item.pageNumber}
              className={cn(
                "block w-full rounded-sm px-2 py-1 text-left text-xs leading-5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-default disabled:opacity-60",
                isActive && "bg-accent font-medium text-accent-foreground",
              )}
              onClick={() => {
                if (item.pageNumber) onJumpPage(item.pageNumber);
              }}
            >
              {item.title}
            </button>
            {item.children.length ? (
              <div className="pl-3">
                <OutlineTree
                  items={item.children}
                  activeKey={activeKey}
                  itemRefs={itemRefs}
                  onJumpPage={onJumpPage}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

Sidebar.displayName = "PdfSidebar";

export default Sidebar;

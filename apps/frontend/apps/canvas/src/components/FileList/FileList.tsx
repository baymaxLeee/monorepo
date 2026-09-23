import { Info as IconInfoCircleFill } from "lucide-react";
import { type Key, type ReactNode, type UIEvent, useCallback, useEffect, useRef, useState } from "react";

import { Button, Empty, Spin } from "@/components/ui";
import t from "@/utils/i18n";

const LOAD_MORE_THRESHOLD = 24;

export interface FileListPage<T> {
  hasMore: boolean;
  items: T[];
}

export interface FileListProps<T> {
  emptyText: string;
  errorText: string;
  getItemKey: (item: T) => Key;
  loadPage: (pageNum: number, pageSize: number) => Promise<FileListPage<T>>;
  pageSize?: number;
  retentionDays?: number;
  renderAction?: (item: T) => ReactNode;
  renderDescription: (item: T) => ReactNode;
  renderIcon?: (item: T) => ReactNode;
  renderTitle: (item: T) => ReactNode;
  retryText: string;
  sourceKey: Key;
}

export function FileList<T>({
  emptyText,
  errorText,
  getItemKey,
  loadPage,
  pageSize = 10,
  retentionDays = 7,
  renderAction,
  renderDescription,
  renderIcon,
  renderTitle,
  retryText,
  sourceKey,
}: FileListProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [pageNum, setPageNum] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [failedPage, setFailedPage] = useState<number>();
  const loadPageRef = useRef(loadPage);
  const requestVersionRef = useRef(0);
  const loadingRef = useRef(false);
  const pagesRef = useRef(new Map<number, T[]>());
  loadPageRef.current = loadPage;

  const requestPage = useCallback(
    async (nextPage: number, replace: boolean) => {
      if (loadingRef.current) {
        return;
      }
      const requestVersion = requestVersionRef.current;
      loadingRef.current = true;
      setLoading(true);
      setFailedPage(undefined);
      try {
        const result = await loadPageRef.current(nextPage, pageSize);
        if (requestVersion !== requestVersionRef.current) {
          return;
        }
        if (replace) {
          pagesRef.current.clear();
        }
        pagesRef.current.set(nextPage, result.items);
        const loadedPages = [...pagesRef.current.entries()].sort(([firstPage], [secondPage]) => firstPage - secondPage);
        const lastLoadedPage = loadedPages[loadedPages.length - 1]?.[0] ?? nextPage;
        setItems(loadedPages.flatMap(([, pageItems]) => pageItems));
        if (nextPage === lastLoadedPage) {
          setPageNum(nextPage);
          setHasMore(result.hasMore);
        }
      } catch {
        if (requestVersion === requestVersionRef.current) {
          setFailedPage(nextPage);
        }
      } finally {
        if (requestVersion === requestVersionRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [pageSize],
  );

  const reloadFirstPage = useCallback(() => {
    requestVersionRef.current += 1;
    loadingRef.current = false;
    pagesRef.current.clear();
    setItems([]);
    setPageNum(0);
    setHasMore(true);
    setFailedPage(undefined);
    void requestPage(1, true);
  }, [requestPage]);

  useEffect(() => {
    reloadFirstPage();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [reloadFirstPage, sourceKey]);

  const retry = () => {
    const nextPage = failedPage ?? (pageNum === 0 ? 1 : pageNum + 1);
    void requestPage(nextPage, nextPage === 1);
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= LOAD_MORE_THRESHOLD;
    if (nearBottom && hasMore && !loadingRef.current && failedPage === undefined) {
      void requestPage(pageNum + 1, false);
    }
  };

  let content: ReactNode;
  if (loading && items.length === 0) {
    content = (
      <div className="flex flex-1 items-center justify-center py-10">
        <Spin />
      </div>
    );
  } else if (failedPage === 1 && items.length === 0) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-[14px] text-muted-foreground">
        <span>{errorText}</span>
        <Button className="text-[13px] text-primary" onClick={retry} size="small" type="text">
          {retryText}
        </Button>
      </div>
    );
  } else if (!loading && items.length === 0) {
    content = (
      <div className="flex flex-1 items-center justify-center py-10">
        <Empty description={emptyText} />
      </div>
    );
  } else {
    content = (
      <div
        aria-label={t("文件列表")}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-1"
        onScroll={handleScroll}
        role="list"
      >
        {items.map((item) => (
          <div
            className="flex min-h-[66px] items-center justify-between gap-3 rounded-[12px] p-3"
            key={getItemKey(item)}
            role="listitem"
          >
            <div className="flex min-w-0 items-center gap-2">
              {renderIcon ? (
                <div className="flex size-7 shrink-0 items-center justify-center">{renderIcon(item)}</div>
              ) : null}
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium leading-5.5 text-foreground">{renderTitle(item)}</div>
                <div className="flex min-w-0 items-center gap-2 text-[12px] leading-5 text-muted-foreground">
                  {renderDescription(item)}
                </div>
              </div>
            </div>
            {renderAction ? (
              <div className="flex size-7 shrink-0 items-center justify-center">{renderAction(item)}</div>
            ) : null}
          </div>
        ))}
        {loading ? (
          <div className="flex h-10 items-center justify-center">
            <Spin size={16} />
          </div>
        ) : failedPage ? (
          <div className="flex h-10 items-center justify-center gap-2 text-[12px] text-muted-foreground">
            <span>{errorText}</span>
            <Button className="text-[12px] text-primary" onClick={retry} size="mini" type="text">
              {retryText}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 bg-[#f4f7ff] px-6 py-2 text-[13px] leading-5.5 text-foreground">
        <IconInfoCircleFill aria-hidden className="shrink-0 text-primary" size={16} strokeWidth={1.5} />
        <span>{t("下载链接有效期为 {retentionDays} 天。", { retentionDays })}</span>
        <Button
          className="ml-auto text-[13px] text-primary"
          disabled={loading}
          onClick={reloadFirstPage}
          size="small"
          type="text"
        >
          {t("刷新列表")}
        </Button>
      </div>
      {content}
    </div>
  );
}

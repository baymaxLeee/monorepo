import type { MouseEvent as ReactMouseEvent } from "react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { cn } from "shared";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { toast } from "sonner";
import type {
  ManagedDocumentKeys,
  ManagedPageKeys,
  PdfHighlight,
  PdfHighlightKeyword,
  PdfHighlightRegions,
  PdfLayout,
  PdfPreviewerDocumentEscapeProps,
  PdfPreviewerPageEscapeProps,
  PdfPreviewerProps,
  PdfPreviewerRef,
  PdfSelectionRegion,
  PdfSidebarType,
} from "../interface";

const isKeywordHighlight = (
  highlight: PdfHighlight,
): highlight is PdfHighlightKeyword =>
  (highlight as PdfHighlightKeyword).keyword !== undefined;

const isRegionsHighlight = (
  highlight: PdfHighlight,
): highlight is PdfHighlightRegions =>
  Array.isArray((highlight as PdfHighlightRegions).regions);

import HighlightLayer, { type HighlightLayerRef } from "./HighlightLayer";
import Sidebar from "./Sidebar";
import PdfToolbar, { isToolbarVisible, resolveToolbarConfig } from "./Toolbar";

const DEFAULT_DOWNLOAD_FILENAME = "document.pdf";

/** keyword 高亮 `<mark>` 的稳定 hook，用于 onHighlightClick 与 scrollToHighlight 选择器 */
const KEYWORD_MARK_DATA_ATTR = "data-pdf-keyword-mark";

/**
 * 不允许通过 `documentProps` 覆盖（与 `ManagedDocumentKeys` 联合保持同步）。
 * 用于内部 merge 时把组件管理字段重新覆盖回 Document props，防御业务通过 documentProps
 * 绕过组件契约。
 */
const MANAGED_DOCUMENT_KEYS: ReadonlyArray<ManagedDocumentKeys> = [
  "children",
  "className",
  "error",
  "file",
  "loading",
  "noData",
  "onLoadError",
  "onLoadSuccess",
  "renderMode",
  "rotate",
  "scale",
];

/** 不允许通过 `pageProps` 覆盖（与 `ManagedPageKeys` 联合保持同步）。 */
const MANAGED_PAGE_KEYS: ReadonlyArray<ManagedPageKeys> = [
  "children",
  "className",
  "customRenderer",
  "error",
  "height",
  "loading",
  "noData",
  "onLoadError",
  "onLoadSuccess",
  "pageIndex",
  "pageNumber",
  "pdf",
  "renderMode",
  "rotate",
  "scale",
  "width",
];

/**
 * 把 `documentProps` / `pageProps` 中"被组件接管"的字段剔除，避免业务绕过组件契约。
 * 类型上已用 `Omit<…, ManagedKeys>` 限制；运行时再做一次防御，覆盖 TS 被绕过 / 业务侧直接传 any 的场景。
 */
const dropManagedKeys = <T extends object>(
  source: T | undefined,
  managed: ReadonlyArray<string>,
): Partial<T> => {
  if (!source) return {};
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (managed.includes(key)) continue;
    result[key] = (source as Record<string, unknown>)[key];
  }
  return result as Partial<T>;
};

type FitMode = Exclude<PdfLayout, number>;

interface PageViewportLike {
  width: number;
  height: number;
  rotation?: number;
}

interface LoadedFileLike {
  numPages: number;
  getPage?: (pageNumber: number) => Promise<unknown>;
  getOutline?: () => Promise<unknown[] | null>;
  getDestination?: (destination: string) => Promise<unknown[] | null>;
  // ref 实际是 pdfjs RefProxy，这里用 any 以避免和 react-pdf 的回调签名变体冲突。
  getPageIndex?: (ref: any) => Promise<number>;
}

interface PageProxyLike {
  getViewport: (params: {
    scale: number;
    rotation?: number;
  }) => PageViewportLike;
}

const escapeRegExp = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const escapeHtml = (input: string): string =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clampScale = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(min, Number(value.toFixed(4))));
};

const getPageViewport = (
  page: unknown,
  params: { scale: number; rotation?: number },
): PageViewportLike | null => {
  try {
    return (page as PageProxyLike).getViewport(params);
  } catch {
    return null;
  }
};

const getDownloadFilename = (url?: string) => {
  if (!url) return DEFAULT_DOWNLOAD_FILENAME;
  try {
    const parsed = new URL(url, window.location.href);
    const filename = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    return filename || DEFAULT_DOWNLOAD_FILENAME;
  } catch {
    return DEFAULT_DOWNLOAD_FILENAME;
  }
};

const triggerDownload = (blob: Blob, filename: string) => {
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
};

const resolveBlobPart = (data: unknown): BlobPart | null => {
  if (data == null) return null;
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.byteLength);
    const source = new Uint8Array(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    );
    for (let index = 0; index < source.length; index += 1) {
      view[index] = source[index];
    }
    return view;
  }
  if (Array.isArray(data)) return new Uint8Array(data);
  return null;
};

const activateHighlightElement = (element: HTMLElement) => {
  element.scrollIntoView?.({ behavior: "smooth", block: "center" });
};

interface SelectionComputeResult {
  regions: PdfSelectionRegion[];
  /** 浮层定位锚点（相对 root 的像素坐标，对应选区可视范围的"顶部水平中心"） */
  anchor: { left: number; top: number };
}

interface CanvasInfoLike {
  /** 0-based 页码 */
  pageIndex: number;
  /** canvas 在视口中的位置（getBoundingClientRect 结果） */
  rect: DOMRect;
}

const collectPageCanvasInfo = (root: HTMLElement): CanvasInfoLike[] => {
  const wrappers = root.querySelectorAll<HTMLElement>("[data-page-number]");
  const result: CanvasInfoLike[] = [];
  wrappers.forEach((wrapper) => {
    const pageNumber = Number(wrapper.dataset.pageNumber);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) return;
    const canvas = wrapper.querySelector<HTMLCanvasElement>(
      ".react-pdf__Page__canvas",
    );
    const rect = (canvas ?? wrapper).getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    result.push({ pageIndex: pageNumber - 1, rect });
  });
  return result;
};

/**
 * 把浏览器原生 Range 拆成"相对每页 canvas 的归一化矩形列表"。
 *
 * - 每行返回一条 region（来自 `range.getClientRects()`）
 * - 选区跨页时按矩形归属拆分到不同 `pageIndex`
 * - 与 canvas 边界相交后再裁剪，避免出现负值或溢出
 * - 退化矩形（< 0.5px）丢弃，避免脏数据
 */
export const computeSelectionRegions = (
  range: Range,
  root: HTMLElement,
): SelectionComputeResult | null => {
  const rectList = range.getClientRects();
  if (!rectList || rectList.length === 0) return null;

  const canvasInfos = collectPageCanvasInfo(root);
  if (canvasInfos.length === 0) return null;

  const rootRect = root.getBoundingClientRect();
  const regions: PdfSelectionRegion[] = [];

  let anchorLeft = Number.POSITIVE_INFINITY;
  let anchorTop = Number.POSITIVE_INFINITY;
  let anchorFound = false;

  for (let index = 0; index < rectList.length; index += 1) {
    const r = rectList[index];
    if (!r || r.width < 0.5 || r.height < 0.5) continue;

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const owner = canvasInfos.find(
      ({ rect }) =>
        cx >= rect.left &&
        cx <= rect.right &&
        cy >= rect.top &&
        cy <= rect.bottom,
    );
    if (!owner) continue;

    const { rect: pageRect, pageIndex } = owner;
    const left = Math.max(r.left, pageRect.left);
    const top = Math.max(r.top, pageRect.top);
    const right = Math.min(r.right, pageRect.right);
    const bottom = Math.min(r.bottom, pageRect.bottom);
    const w = right - left;
    const h = bottom - top;
    if (w < 0.5 || h < 0.5) continue;

    regions.push({
      pageIndex,
      left: ((left - pageRect.left) / pageRect.width) * 100,
      top: ((top - pageRect.top) / pageRect.height) * 100,
      width: (w / pageRect.width) * 100,
      height: (h / pageRect.height) * 100,
    });

    const cxRoot = (left + right) / 2 - rootRect.left;
    const topRoot = top - rootRect.top;
    if (!anchorFound || topRoot < anchorTop) {
      anchorTop = topRoot;
      anchorLeft = cxRoot;
      anchorFound = true;
    }
  }

  if (regions.length === 0 || !anchorFound) return null;

  return {
    regions,
    anchor: { left: anchorLeft, top: anchorTop },
  };
};

// 仅处理 layout === 字符串 布局
const resolveBestFitScale = ({
  page,
  viewportEl,
  fitMode,
  rotation,
  minScale,
  maxScale,
}: {
  page: unknown;
  viewportEl: HTMLDivElement;
  fitMode: FitMode;
  rotation: number;
  minScale: number;
  maxScale: number;
}) => {
  const baseViewport = getPageViewport(page, { scale: 1, rotation });
  if (!baseViewport) return null;

  const availableW = Math.max(0, viewportEl.offsetWidth);
  const availableH = Math.max(0, viewportEl.clientHeight);
  if (availableW <= 0 || availableH <= 0) return 1;

  let nextScale = 1;
  if (fitMode === "page-width") {
    nextScale = availableW / baseViewport.width;
  } else if (fitMode === "page-height") {
    nextScale = availableH / baseViewport.height;
  } else {
    nextScale = Math.min(
      availableW / baseViewport.width,
      availableH / baseViewport.height,
    );
  }

  return clampScale(nextScale, minScale, maxScale);
};

const PdfPreviewerInner = forwardRef<PdfPreviewerRef, PdfPreviewerProps>(
  (props, ref) => {
    const {
      file,
      workerSrc,
      initialPage = 1,
      layout = "page-width",
      minScale = 0.25,
      maxScale = 4,
      scaleStep = 0.2,
      width = "100%",
      height = "100%",
      toolbar = true,
      highlights,
      autoScrollToFirstHighlight = true,
      onHighlightClick,
      renderSelectionToolbar,
      onTextSelect,
      onDownload,
      toolbarExtraRender,
      loadingText = "文件解析中...",
      errorText = "文件解析失败",
      emptyText = "暂无 PDF 数据",
      defaultSidebar = null,
      sidebarWidth = 200,
      onSidebarChange,
      onLoadSuccess,
      onLoadError,
      onPageChange,
      onScaleChange,
      style,
      className,
      documentProps,
      pageProps,
    } = props;

    // 剔除"组件接管"字段，防御 TS 被绕过 / 业务侧直接传 any 的场景。
    const safeDocumentProps = useMemo<PdfPreviewerDocumentEscapeProps>(
      () => dropManagedKeys(documentProps, MANAGED_DOCUMENT_KEYS),
      [documentProps],
    );
    const safePageProps = useMemo<PdfPreviewerPageEscapeProps>(
      () => dropManagedKeys(pageProps, MANAGED_PAGE_KEYS),
      [pageProps],
    );
    const rootRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const pdfDocumentRef = useRef<LoadedFileLike | null>(null);
    const documentLoadTokenRef = useRef(0);
    const pendingScrollHighlightIdRef = useRef<string | null>(null);
    const initialContinuousScrollDoneRef = useRef(false);
    const visiblePageMapRef = useRef<Record<number, number>>({});
    const autoScaleRafRef = useRef<number | null>(null);
    const pageElementRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const highlightLayerRef = useRef<HighlightLayerRef | null>(null);
    const [pageProxyMap, setPageProxyMap] = useState<Record<number, unknown>>(
      {},
    );
    const [pdfDocument, setPdfDocument] = useState<LoadedFileLike | null>(null);

    const toolbarConfig = useMemo(
      () => resolveToolbarConfig(toolbar),
      [toolbar],
    );
    const toolbarVisible = useMemo(
      () =>
        isToolbarVisible(toolbarConfig) ||
        (toolbar !== false && Boolean(toolbarExtraRender)),
      [toolbar, toolbarConfig, toolbarExtraRender],
    );

    const [numPages, setNumPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage));
    const pageProxy = pageProxyMap[currentPage] ?? null;
    const fitModeRef = useRef<FitMode | null>(
      typeof layout === "number" ? null : layout,
    );
    const [scale, setScale] = useState<number | undefined>(
      typeof layout === "number" ? layout : undefined,
    );
    const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
    const [loadStatus, setLoadStatus] = useState<
      "idle" | "loading" | "ready" | "error"
    >("idle");
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [sidebarType, setSidebarType] =
      useState<PdfSidebarType>(defaultSidebar);
    const [selectionState, setSelectionState] = useState<{
      text: string;
      regions: PdfSelectionRegion[];
      anchor: { left: number; top: number };
    } | null>(null);

    const cancelAutoScaleFrame = () => {
      if (autoScaleRafRef.current === null) return;
      window.cancelAnimationFrame(autoScaleRafRef.current);
      autoScaleRafRef.current = null;
    };

    /**
     * 收起选区状态：仅在当前确实有选区时触发 `onTextSelect(null)`，避免重复回调。
     */
    const resetSelection = () => {
      setSelectionState((prev) => {
        if (prev === null) return prev;
        onTextSelect?.(null);
        return null;
      });
    };

    const clearSelection = () => {
      if (typeof window !== "undefined") {
        try {
          window.getSelection()?.removeAllRanges();
        } catch {
          // 极少数沙盒环境（如 jsdom 在跨 frame 场景）抛错，忽略即可
        }
      }
      resetSelection();
    };

    useEffect(() => {
      if (pdfjs.GlobalWorkerOptions.workerSrc !== workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      }
    }, [workerSrc]);

    useEffect(() => {
      documentLoadTokenRef.current += 1;
      cancelAutoScaleFrame();
      pdfDocumentRef.current = null;
      setPdfDocument(null);
      pendingScrollHighlightIdRef.current = null;
      initialContinuousScrollDoneRef.current = false;
      pageElementRefs.current = {};
      visiblePageMapRef.current = {};
      setLoadStatus(file ? "loading" : "idle");
      setNumPages(0);
      setCurrentPage(Math.max(1, initialPage));
      setPageProxyMap({});
      fitModeRef.current = typeof layout === "number" ? null : layout;
      setScale(typeof layout === "number" ? layout : undefined);
      setRotation(0);
      setSidebarType(defaultSidebar);
      resetSelection();
      // 故意只依赖 file：换文件时复位状态，其他 prop 变化不应触发整体复位
    }, [file]);

    const selectionEnabled = Boolean(renderSelectionToolbar || onTextSelect);
    useEffect(() => {
      if (!selectionEnabled) return;
      const root = rootRef.current;
      if (!root || typeof window === "undefined") return;

      let mouseupRaf: number | null = null;

      const recompute = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          resetSelection();
          return;
        }
        const range = selection.getRangeAt(0);
        const startNode = range.startContainer;
        const startEl =
          startNode.nodeType === Node.ELEMENT_NODE
            ? (startNode as Element)
            : startNode.parentElement;
        if (!startEl || !root.contains(startEl)) {
          resetSelection();
          return;
        }
        const text = selection.toString().trim();
        if (!text) {
          resetSelection();
          return;
        }
        const computed = computeSelectionRegions(range, root);
        if (!computed) {
          resetSelection();
          return;
        }
        const next = {
          text,
          regions: computed.regions,
          anchor: computed.anchor,
        };
        setSelectionState(next);
        onTextSelect?.({
          text: next.text,
          regions: next.regions,
        });
      };

      const handleMouseUp = () => {
        if (mouseupRaf !== null) {
          window.cancelAnimationFrame(mouseupRaf);
        }
        mouseupRaf = window.requestAnimationFrame(() => {
          mouseupRaf = null;
          recompute();
        });
      };

      const handleSelectionChange = () => {
        const selection = window.getSelection();
        // 拖拽过程中频繁触发；只在"选区被清空"时及时收起浮层，避免抖动
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          resetSelection();
        }
      };

      document.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("selectionchange", handleSelectionChange);
      return () => {
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("selectionchange", handleSelectionChange);
        if (mouseupRaf !== null) {
          window.cancelAnimationFrame(mouseupRaf);
        }
      };
    }, [selectionEnabled]);

    const keywordHighlights = useMemo<PdfHighlightKeyword[]>(
      () => (highlights || []).filter(isKeywordHighlight),
      [highlights],
    );

    const regionHighlights = useMemo<PdfHighlightRegions[]>(
      () => (highlights || []).filter(isRegionsHighlight),
      [highlights],
    );

    const keywordTextRenderer = useMemo(() => {
      if (keywordHighlights.length === 0) return undefined;
      // 与 react-pdf 的 CustomTextRenderer 签名兼容（仅读 str，其余字段忽略）
      return (props: { str: string }): string => {
        const { str } = props;
        if (!str) return str;
        let html = escapeHtml(str);
        keywordHighlights.forEach((highlight) => {
          if (!highlight.keyword) return;
          const pattern = (() => {
            if (!(highlight.keyword instanceof RegExp)) {
              return new RegExp(escapeRegExp(String(highlight.keyword)), "gi");
            }
            const flags = highlight.keyword.flags;
            return new RegExp(
              highlight.keyword.source,
              flags.includes("g") ? flags : `${flags}g`,
            );
          })();
          // 业务未显式传 color 时走默认偏黄半透明底色
          const bg = highlight.color ?? "rgb(250 204 21 / 35%)";
          const styleAttr = ` style="background:${bg}"`;
          const cls = cn("rounded-sm", highlight.className);
          const dataId = highlight.id
            ? ` data-highlight-id="${highlight.id}"`
            : "";
          html = html.replace(
            pattern,
            (match) =>
              `<mark ${KEYWORD_MARK_DATA_ATTR}="" class="${cls}"${styleAttr}${dataId}>${match}</mark>`,
          );
        });
        return html;
      };
    }, [keywordHighlights]);

    const composedCustomTextRenderer = useMemo(() => {
      const userRenderer = pageProps?.customTextRenderer;
      if (!keywordTextRenderer && !userRenderer) return undefined;
      // 用 Parameters 取 react-pdf 真实入参（含 TextItem & pageIndex/pageNumber 等）
      type Args = Parameters<NonNullable<typeof userRenderer>>[0];
      return (params: Args): string => {
        let str: string = params.str;
        if (keywordTextRenderer) {
          str = keywordTextRenderer({ str });
        }
        if (userRenderer) {
          str = userRenderer({ ...params, str });
        }
        return str;
      };
    }, [keywordTextRenderer, pageProps?.customTextRenderer]);

    const scheduleFitScale = (fitMode: FitMode, targetPage?: unknown) => {
      fitModeRef.current = fitMode;
      cancelAutoScaleFrame();
      autoScaleRafRef.current = window.requestAnimationFrame(() => {
        autoScaleRafRef.current = null;
        const viewportEl = viewportRef.current;
        const page = targetPage ?? pageProxy;
        if (!page || !viewportEl) return;
        const nextScale = resolveBestFitScale({
          page,
          viewportEl,
          fitMode,
          rotation,
          minScale,
          maxScale,
        });
        if (nextScale == null) return;
        setScale((prev) =>
          prev !== undefined && Math.abs(prev - nextScale) < 1e-4
            ? prev
            : nextScale,
        );
      });
    };

    useEffect(() => {
      return () => {
        if (autoScaleRafRef.current !== null) {
          window.cancelAnimationFrame(autoScaleRafRef.current);
          autoScaleRafRef.current = null;
        }
      };
    }, []);

    // viewport 尺寸变化 + 页面就绪/翻页 + 旋转/缩放区间变化 都收敛到这一个 effect
    useEffect(() => {
      if (!viewportRef.current) return;
      const scheduleCurrentFit = () => {
        const fitMode = fitModeRef.current;
        if (fitMode) {
          scheduleFitScale(fitMode);
        }
      };

      if (typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", scheduleCurrentFit);
        return () => {
          window.removeEventListener("resize", scheduleCurrentFit);
        };
      }

      const observer = new ResizeObserver(scheduleCurrentFit);
      observer.observe(viewportRef.current);
      return () => {
        observer.disconnect();
      };
    }, [pageProxy, rotation, minScale, maxScale]);

    useEffect(() => {
      const sync = () => {
        const root = rootRef.current;
        if (!root) {
          setIsFullscreen(false);
          return;
        }
        const el = document.fullscreenElement;
        setIsFullscreen(Boolean(el && (el === root || root.contains(el))));
      };
      sync();
      document.addEventListener("fullscreenchange", sync);
      return () => {
        document.removeEventListener("fullscreenchange", sync);
      };
    }, []);

    useEffect(() => {
      if (scale === undefined) return;
      onScaleChange?.(scale);
    }, [scale]);

    useEffect(() => {
      onPageChange?.(currentPage);
    }, [currentPage]);

    useEffect(() => {
      if (
        !viewportRef.current ||
        numPages <= 0 ||
        loadStatus !== "ready" ||
        scale === undefined ||
        typeof IntersectionObserver === "undefined"
      ) {
        return;
      }
      const viewportEl = viewportRef.current;

      const syncCurrentPage = () => {
        setCurrentPage((prev) => {
          let nextPage = prev;
          let maxVisibleHeight = visiblePageMapRef.current[prev] ?? 0;

          for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
            const visibleHeight = visiblePageMapRef.current[pageNumber] ?? 0;
            if (visibleHeight > maxVisibleHeight) {
              nextPage = pageNumber;
              maxVisibleHeight = visibleHeight;
            }
          }

          return nextPage === prev ? prev : nextPage;
        });
      };

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const pageNumber = Number(
              (entry.target as HTMLElement).dataset.pageNumber,
            );
            if (!Number.isFinite(pageNumber)) return;
            visiblePageMapRef.current[pageNumber] = entry.isIntersecting
              ? entry.intersectionRect.height
              : 0;
          });
          syncCurrentPage();
        },
        {
          root: viewportEl,
          threshold: Array.from({ length: 21 }, (_, index) => index / 20),
        },
      );

      for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
        const element = pageElementRefs.current[pageNumber];
        if (element) {
          observer.observe(element);
        }
      }

      return () => {
        observer.disconnect();
      };
    }, [scale, loadStatus, numPages]);

    useEffect(() => {
      if (loadStatus !== "ready" || scale === undefined) {
        initialContinuousScrollDoneRef.current = false;
        return;
      }
      if (initialContinuousScrollDoneRef.current) return;
      const rafId = window.requestAnimationFrame(() => {
        const element = pageElementRefs.current[currentPage];
        if (!element) return;
        initialContinuousScrollDoneRef.current = true;
        element.scrollIntoView?.({
          behavior: "auto",
          block: "start",
        });
      });
      return () => {
        window.cancelAnimationFrame(rafId);
      };
    }, [scale, currentPage, loadStatus]);

    const handleDocumentLoadSuccess = (pdf: LoadedFileLike) => {
      const loadToken = documentLoadTokenRef.current;
      pdfDocumentRef.current = pdf;
      setPdfDocument(pdf);
      setNumPages(pdf.numPages);
      setLoadStatus("ready");
      const next = Math.min(Math.max(1, currentPage), pdf.numPages || 1);
      setCurrentPage(next);
      if (typeof layout === "number") {
        setScale(layout);
      } else if (typeof pdf.getPage === "function") {
        void pdf
          .getPage(next)
          .then((page) => {
            if (
              documentLoadTokenRef.current !== loadToken ||
              pdfDocumentRef.current !== pdf
            ) {
              return;
            }
            setPageProxyMap((prev) => {
              if (prev[next] === page) return prev;
              return { ...prev, [next]: page };
            });
          })
          .catch(() => {
            if (
              documentLoadTokenRef.current === loadToken &&
              pdfDocumentRef.current === pdf
            ) {
              setScale(1);
            }
          });
      } else {
        setScale(1);
      }
      onLoadSuccess?.({ numPages: pdf.numPages, pdf });
    };

    const handleDocumentLoadError = (error: Error) => {
      documentLoadTokenRef.current += 1;
      pdfDocumentRef.current = null;
      setPdfDocument(null);
      setLoadStatus("error");
      onLoadError?.(error);
    };

    const handlePageLoadSuccess = (pageNumber: number, page: unknown) => {
      setPageProxyMap((prev) => {
        if (prev[pageNumber] === page) return prev;
        return { ...prev, [pageNumber]: page };
      });
    };

    const handlePageRenderSuccess = (pageProxy: unknown) => {
      if (pendingScrollHighlightIdRef.current) {
        const id = pendingScrollHighlightIdRef.current;
        window.requestAnimationFrame(() => {
          const element =
            highlightLayerRef.current?.getHighlightElement(id) ?? null;
          if (element) {
            pendingScrollHighlightIdRef.current = null;
            activateHighlightElement(element);
          }
        });
      }
      const userOnRenderSuccess = pageProps?.onRenderSuccess;
      userOnRenderSuccess?.(
        pageProxy as Parameters<NonNullable<typeof userOnRenderSuccess>>[0],
      );
    };

    const scrollToPage = (
      pageNumber: number,
      behavior: ScrollBehavior = "smooth",
    ) => {
      const element = pageElementRefs.current[pageNumber];
      if (!element || typeof element.scrollIntoView !== "function") {
        return false;
      }
      element.scrollIntoView({ behavior, block: "start" });
      return true;
    };

    const goToPage = (page: number) => {
      if (!Number.isFinite(page)) return;
      const next = Math.min(
        Math.max(1, Math.trunc(page)),
        numPages || Math.max(1, currentPage),
      );
      window.requestAnimationFrame(() => {
        scrollToPage(next);
      });
    };

    const nextPage = () => goToPage(currentPage + 1);
    const prevPage = () => goToPage(currentPage - 1);

    const setManualScale = (value: number) => {
      const clamped = clampScale(value, minScale, maxScale);
      fitModeRef.current = null;
      setScale(clamped);
    };

    const zoomIn = () => setManualScale((scale ?? 1) + scaleStep);
    const zoomOut = () => setManualScale((scale ?? 1) - scaleStep);

    const rotateBy = (deg?: 0 | 90 | 180 | 270) => {
      if (deg === 0 || deg === 90 || deg === 180 || deg === 270) {
        setRotation(deg);
        return;
      }
      setRotation((prev) => {
        const next = (prev + 90) % 360;
        return next as 0 | 90 | 180 | 270;
      });
    };

    const toggleFullscreen = () => {
      if (!rootRef.current) return;
      if (isFullscreen) {
        document.exitFullscreen?.();
      } else {
        rootRef.current.requestFullscreen?.();
      }
    };

    const applySidebar = (next: PdfSidebarType) => {
      setSidebarType((prev) => {
        if (prev === next) return prev;
        onSidebarChange?.(next);
        return next;
      });
    };

    const handleDownload = async () => {
      if (onDownload) {
        await onDownload({ file, pdf: pdfDocumentRef.current });
        return;
      }
      if (!file) return;
      try {
        if (typeof file === "string") {
          const response = await fetch(file);
          if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status}`);
          }
          triggerDownload(await response.blob(), getDownloadFilename(file));
          return;
        }

        if (file instanceof Blob) {
          const filename =
            file instanceof File && file.name
              ? file.name
              : DEFAULT_DOWNLOAD_FILENAME;
          triggerDownload(file, filename);
          return;
        }

        if (file instanceof ArrayBuffer) {
          triggerDownload(
            new Blob([file], { type: "application/pdf" }),
            DEFAULT_DOWNLOAD_FILENAME,
          );
          return;
        }

        if (
          typeof file === "object" &&
          "url" in file &&
          typeof file.url === "string"
        ) {
          const response = await fetch(file.url);
          if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status}`);
          }
          triggerDownload(await response.blob(), getDownloadFilename(file.url));
          return;
        }

        if (typeof file === "object" && "data" in file) {
          const blobPart = resolveBlobPart(file.data);
          if (blobPart) {
            triggerDownload(
              new Blob([blobPart], { type: "application/pdf" }),
              DEFAULT_DOWNLOAD_FILENAME,
            );
            return;
          }
        }

        throw new Error("Unsupported PDF file source");
      } catch {
        toast.error("下载失败");
      }
    };

    const handleKeywordHighlightClick = (
      event: ReactMouseEvent<HTMLDivElement>,
    ) => {
      if (!onHighlightClick || keywordHighlights.length === 0) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const mark = target.closest(
        `[${KEYWORD_MARK_DATA_ATTR}]`,
      ) as HTMLElement | null;
      if (!mark) return;
      const id = mark.getAttribute("data-highlight-id") || undefined;
      const index = keywordHighlights.findIndex(
        (highlight) => (highlight.id ?? undefined) === id,
      );
      const highlight = index >= 0 ? keywordHighlights[index] : null;
      if (!highlight) return;
      onHighlightClick({
        highlight,
        index,
        event: event.nativeEvent,
      });
    };

    const handleRegionHighlightClick = (payload: {
      highlight: PdfHighlight;
      index: number;
      event: MouseEvent;
    }) => {
      if (!onHighlightClick) return;
      const originalIndex = (highlights || []).indexOf(payload.highlight);
      onHighlightClick({
        highlight: payload.highlight,
        index: originalIndex >= 0 ? originalIndex : payload.index,
        event: payload.event,
      });
    };

    const scrollToHighlightById = (id: string) => {
      if (!id || !highlights?.length) return;
      const target = highlights.find((item) => item.id === id);
      if (!target) return;

      const existingElement =
        highlightLayerRef.current?.getHighlightElement(id);
      if (existingElement) {
        activateHighlightElement(existingElement);
        return;
      }

      // 仅 regions 形态可推断目标页（取首条 region.pageIndex）；
      // keyword 形态命不中已渲染 DOM 时无法定位具体页，跳过
      if (!isRegionsHighlight(target)) return;
      const firstRegion = target.regions[0];
      if (!firstRegion) return;
      pendingScrollHighlightIdRef.current = id;
      goToPage(firstRegion.pageIndex + 1);
    };

    // 仅依赖「首条 id」而非 highlights 引用：避免父组件重渲染、尾部追加、多源合并等
    const firstHighlightId = highlights?.[0]?.id;
    useEffect(() => {
      if (autoScrollToFirstHighlight === false) return;
      if (loadStatus !== "ready") return;
      if (!firstHighlightId) return;
      scrollToHighlightById(firstHighlightId);
    }, [firstHighlightId, loadStatus, autoScrollToFirstHighlight]);

    useImperativeHandle(ref, () => ({
      goToPage,
      nextPage,
      prevPage,
      zoomIn,
      zoomOut,
      setScale: setManualScale,
      fitWidth: () => scheduleFitScale("page-width"),
      fitHeight: () => scheduleFitScale("page-height"),
      fitPage: () => scheduleFitScale("page-fit"),
      rotate: rotateBy,
      toggleFullscreen,
      scrollToHighlight: scrollToHighlightById,
      getPdfInstance: () => pdfDocumentRef.current,
      setSidebar: applySidebar,
    }));

    /**
     * Tooltip / DropdownMenu 等 portal 的容器：
     * - 全屏时挂到 root（否则全屏元素覆盖 body 后浮层不可见）
     * - 非全屏时返回 null，走 radix 默认（document.body）
     */
    const popupContainer = isFullscreen ? rootRef.current : null;

    const download = () => {
      void handleDownload().catch(() => {});
    };

    const canOperate = loadStatus === "ready" && scale !== undefined;
    const displayScale = scale ?? 1;

    const toolbarExtra = toolbarExtraRender?.({
      numPages,
      currentPage,
      scale: displayScale,
      fullscreen: isFullscreen,
      canOperate,
      sidebarType,
      actions: {
        goToPage,
        nextPage,
        prevPage,
        zoomIn,
        zoomOut,
        setScale: setManualScale,
        fitWidth: () => scheduleFitScale("page-width"),
        fitHeight: () => scheduleFitScale("page-height"),
        fitPage: () => scheduleFitScale("page-fit"),
        rotate: rotateBy,
        toggleFullscreen,
        scrollToHighlight: scrollToHighlightById,
        getPdfInstance: () => pdfDocumentRef.current,
        setSidebar: applySidebar,
        download,
      },
    });

    const pageNumbers = useMemo(
      () => Array.from({ length: numPages }, (_, index) => index + 1),
      [numPages],
    );

    const stateClass =
      "flex h-full min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground";

    return (
      <div
        ref={rootRef}
        style={{ ...style, width, height }}
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-md border bg-muted/20 text-sm text-foreground",
          className,
        )}
        data-testid="pdf-previewer"
      >
        {toolbarVisible ? (
          <PdfToolbar
            enabled={toolbarConfig}
            numPages={numPages}
            currentPage={currentPage}
            scale={displayScale}
            minScale={minScale}
            maxScale={maxScale}
            fullscreen={isFullscreen}
            canOperate={canOperate}
            downloadDisabled={!onDownload && !file}
            sidebarType={sidebarType}
            popupContainer={popupContainer}
            onPrevPage={prevPage}
            onNextPage={nextPage}
            onGoToPage={goToPage}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onSetScale={setManualScale}
            onFit={scheduleFitScale}
            onRotate={() => rotateBy()}
            onDownload={download}
            onToggleFullscreen={toggleFullscreen}
            onSetSidebar={applySidebar}
            extra={toolbarExtra}
          />
        ) : null}

        {!file ? (
          <div className="relative flex min-h-0 flex-1">
            <div className={stateClass}>{emptyText}</div>
          </div>
        ) : (
          <Document
            {...safeDocumentProps}
            file={file}
            loading={<div className={stateClass}>{loadingText}</div>}
            error={<div className={stateClass}>{errorText}</div>}
            noData={<div className={stateClass}>{emptyText}</div>}
            onLoadSuccess={handleDocumentLoadSuccess}
            onLoadError={handleDocumentLoadError}
            className="relative flex min-h-0 flex-1 overflow-hidden"
          >
            <Sidebar
              sidebarType={sidebarType}
              numPages={numPages}
              currentPage={currentPage}
              pdf={pdfDocument}
              width={sidebarWidth}
              onJumpPage={goToPage}
            />

            <div
              className="scrollbar-hide relative min-w-0 flex-1 overflow-auto [&_.react-pdf\\_\\_Page__canvas]:mx-auto [&_.react-pdf\\_\\_Page__canvas]:block"
              ref={viewportRef}
            >
              <div className="flex flex-col items-center gap-4 py-4">
                {scale !== undefined ? (
                  pageNumbers.map((pageNumber) => (
                    <div
                      key={pageNumber}
                      ref={(node) => {
                        pageElementRefs.current[pageNumber] = node;
                      }}
                      className="relative shadow-sm"
                      data-page-number={pageNumber}
                      data-testid={`pdf-page-wrapper-${pageNumber}`}
                      onClick={handleKeywordHighlightClick}
                    >
                      <Page
                        {...safePageProps}
                        scale={scale}
                        rotate={rotation}
                        pageNumber={pageNumber}
                        loading={null}
                        customTextRenderer={composedCustomTextRenderer}
                        onLoadSuccess={(page) =>
                          handlePageLoadSuccess(pageNumber, page)
                        }
                        onRenderSuccess={handlePageRenderSuccess}
                      />
                      <HighlightLayer
                        ref={
                          pageNumber === currentPage
                            ? highlightLayerRef
                            : undefined
                        }
                        pageNumber={pageNumber}
                        highlights={regionHighlights}
                        onHighlightClick={
                          onHighlightClick
                            ? handleRegionHighlightClick
                            : undefined
                        }
                      />
                    </div>
                  ))
                ) : (
                  <div className={stateClass}>{loadingText}</div>
                )}
              </div>
            </div>
          </Document>
        )}

        {selectionState && renderSelectionToolbar
          ? (() => {
              const node = renderSelectionToolbar({
                text: selectionState.text,
                regions: selectionState.regions,
                close: clearSelection,
              });
              if (!node) return null;
              return (
                <div
                  className="absolute z-20 -translate-x-1/2 -translate-y-full pb-1"
                  data-testid="pdf-selection-toolbar"
                  // 阻止点击工具栏触发选区清空（mousedown 会让浏览器收起 selection）
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  style={{
                    left: selectionState.anchor.left,
                    top: selectionState.anchor.top,
                  }}
                >
                  {node}
                </div>
              );
            })()
          : null}
      </div>
    );
  },
);

PdfPreviewerInner.displayName = "PdfPreviewerInner";

export default PdfPreviewerInner;

// 避免 TS 未使用警告（PdfHighlight 类型在 interface.ts 声明供外部使用）
export type { FitMode, PdfHighlight, PdfSelectionRegion };
// 便于测试的命名导出
export { clampScale, resolveBestFitScale };

import type { CSSProperties, ReactNode } from "react";
import type { DocumentProps, PageProps } from "react-pdf";

export type PdfLayout = "page-width" | "page-height" | "page-fit" | number;

/**
 * @title PdfSidebarType
 * @zh 侧边栏当前展示类型，`null` 表示不渲染侧边栏
 */
export type PdfSidebarType = "outline" | "thumbnail" | null;

/**
 * @title PdfHighlightCommon
 * @zh 所有高亮形态共享的通用字段
 * @internal
 */
interface PdfHighlightCommon {
  /**
   * @zh 高亮唯一标识，配合 `ref.scrollToHighlight(id)` / 自动滚动使用
   */
  id?: string;
  /**
   * @zh 高亮填充色
   * @default "var(--pdf-previewer-highlight-color)"
   * @description 不传则走容器 CSS 变量 `--pdf-previewer-highlight-color`（默认偏黄半透明），
   *   业务可通过 less / 全局样式覆盖该变量统一改色；若需精确指定单条颜色，传入任意合法 CSS color 字符串即可
   */
  color?: string;
  /**
   * @zh 额外类名，会同时作用于 overlay 块与 keyword 的 `<mark>` 标签
   */
  className?: string;
  /**
   * @zh 业务透传数据，点击回调 `onHighlightClick` 时回传
   */
  data?: unknown;
}

/**
 * @title PdfHighlightRegions
 * @zh 百分比 region 高亮：与 `onTextSelect` / `renderSelectionToolbar` 输出格式完全对称
 * @description 业务侧把保存的 `PdfSelectionPayload.regions` 原样回传即可；
 *   每个 region 自带 `pageIndex`，天然支持跨页选区
 */
export type PdfHighlightRegions = PdfHighlightCommon & {
  /** 相对每页 canvas 的归一化矩形列表（百分比 0~100） */
  regions: PdfSelectionRegion[];
  keyword?: never;
};

/**
 * @title PdfHighlightKeyword
 * @zh 文本关键字高亮：通过 customTextRenderer 包 `<mark>`
 */
export type PdfHighlightKeyword = PdfHighlightCommon & {
  /**
   * @zh 关键字或正则，走文本层高亮（customTextRenderer）
   * @description 字符串匹配默认大小写不敏感（gi）；需要精确匹配请传正则
   */
  keyword: string | RegExp;
  regions?: never;
};

/**
 * @title PdfHighlight
 * @zh PDF 单条高亮描述：regions（位置）或 keyword（关键字）二选一
 */
export type PdfHighlight = PdfHighlightRegions | PdfHighlightKeyword;

export interface PdfToolbarConfig {
  /** 翻页（上一页/下一页/页码跳转） */
  pageNav?: boolean;
  /** 缩放（+/-、百分比展示、适配下拉） */
  zoom?: boolean;
  /** 旋转 90° */
  rotate?: boolean;
  /** 下载 */
  download?: boolean;
  /** 全屏 */
  fullscreen?: boolean;
  /** 大纲入口按钮 */
  outline?: boolean;
  /** 缩略图入口按钮 */
  thumbnail?: boolean;
}

export interface PdfLoadSuccessPayload {
  numPages: number;
  pdf: unknown;
}

export interface PdfHighlightClickPayload {
  highlight: PdfHighlight;
  index: number;
  event: MouseEvent;
}

export interface PdfDownloadPayload {
  file?: DocumentProps["file"];
  pdf: unknown | null;
}

/**
 * @title PdfSelectionRegion
 * @zh PDF 文本选区在某页中的归一化矩形（百分比，0~100）
 * @description 参考系为该页 canvas 的渲染区域，原点位于左上角，跨缩放/旋转/容器尺寸均可还原；
 * 多行选区会被拆分为多个 region，业务可直接序列化存储后端，回放时配合 `highlights` 渲染
 */
export interface PdfSelectionRegion {
  /** 0-based 页码 */
  pageIndex: number;
  /** 相对该页 canvas 的左偏移百分比 */
  left: number;
  /** 相对该页 canvas 的上偏移百分比 */
  top: number;
  /** 相对该页 canvas 的宽度百分比 */
  width: number;
  /** 相对该页 canvas 的高度百分比 */
  height: number;
}

/**
 * @title PdfSelectionPayload
 * @zh 文本选区数据载荷
 */
export interface PdfSelectionPayload {
  /** 选中的纯文本（已 trim） */
  text: string;
  /** 多行选区拆分后的归一化矩形列表，可直接持久化 */
  regions: PdfSelectionRegion[];
}

/**
 * @title PdfSelectionToolbarPayload
 * @zh 文本选区工具栏渲染参数
 */
export interface PdfSelectionToolbarPayload extends PdfSelectionPayload {
  /** 主动收起工具栏并清除浏览器选区 */
  close: () => void;
}

export interface PdfToolbarRenderPayload {
  numPages: number;
  currentPage: number;
  scale: number;
  fullscreen: boolean;
  canOperate: boolean;
  /** 当前侧边栏渲染类型 */
  sidebarType: PdfSidebarType;
  actions: Pick<
    PdfPreviewerRef,
    | "goToPage"
    | "nextPage"
    | "prevPage"
    | "zoomIn"
    | "zoomOut"
    | "setScale"
    | "fitWidth"
    | "fitHeight"
    | "fitPage"
    | "rotate"
    | "toggleFullscreen"
    | "scrollToHighlight"
    | "getPdfInstance"
    | "setSidebar"
  > & {
    download: () => void;
  };
}

/**
 * @title ManagedDocumentKeyHints
 * @zh 由 `PdfPreviewer` 接管 / 包装 / 升级语义的 `react-pdf` Document props key 索引
 * @description 这些字段不允许通过 `documentProps` 逃生通道覆盖；每个 key 的 jsdoc 说明被收敛到哪个对外 prop。
 *   字段值类型固定为 `never`，仅用于 `keyof` 派生 `ManagedDocumentKeys`。
 * @internal
 */
export interface ManagedDocumentKeyHints {
  /** 由组件内部固定渲染（Sidebar + 多页 Page 子树），业务无法替换。 */
  children: never;
  /** 由组件内部固定为 `pdf-previewer-body`；外层容器 className 走 `PdfPreviewerProps.className`。 */
  className: never;
  /** 收敛为 `PdfPreviewerProps.errorText`，包装为带样式的状态节点后再传给 Document。 */
  error: never;
  /** 收敛为 `PdfPreviewerProps.file`。 */
  file: never;
  /** 收敛为 `PdfPreviewerProps.loadingText`，包装为带样式的状态节点后再传给 Document。 */
  loading: never;
  /** 收敛为 `PdfPreviewerProps.emptyText`，包装为带样式的状态节点后再传给 Document。 */
  noData: never;
  /** 收敛为 `PdfPreviewerProps.onLoadError`，组件需要先重置内部 loadStatus 再回调业务。 */
  onLoadError: never;
  /** 收敛为 `PdfPreviewerProps.onLoadSuccess`，payload 升级为 `{ numPages, pdf }`。 */
  onLoadSuccess: never;
  /** 内部固定为 `canvas`；如需 `custom` 渲染请单独评估再开口。 */
  renderMode: never;
  /** 收敛为内部 state + `ref.rotate(deg?)`；toolbar 旋转按钮也走同一通路。 */
  rotate: never;
  /** 组件以 Page 级 scale 管理（每页独立缩放 + 自适应 fit）；不允许 Document 级全局 scale 覆盖。 */
  scale: never;
}

/**
 * @title ManagedDocumentKeys
 * @zh 被 `PdfPreviewer` 接管的 `react-pdf` Document props key 联合，参见 {@link ManagedDocumentKeyHints}。
 */
export type ManagedDocumentKeys = keyof ManagedDocumentKeyHints;

/**
 * @title ManagedPageKeyHints
 * @zh 由 `PdfPreviewer` 接管 / 包装 / 升级语义的 `react-pdf` Page props key 索引
 * @description 这些字段不允许通过 `pageProps` 逃生通道覆盖；每个 key 的 jsdoc 说明被收敛到哪个对外 prop。
 *   `customTextRenderer` / `onRenderSuccess` 不在此名单：组件会与业务传入做"叠加"调用。
 * @internal
 */
export interface ManagedPageKeyHints {
  /** Page 子树由组件内部渲染高亮 overlay；不允许业务通过 children 介入。 */
  children: never;
  /** 由组件内部固定为 `pdf-previewer-page`。 */
  className: never;
  /** Page custom renderer 与 `renderMode='custom'` 配套；组件未开放该模式。 */
  customRenderer: never;
  /** Page 错误兜底由 Document 层统一渲染。 */
  error: never;
  /** Page 高度由 scale + 旋转推导，不允许直接指定。 */
  height: never;
  /** 内部固定 `null`，由 Document 级 loadingText 统一兜底，避免每页重复出现 loader。 */
  loading: never;
  /** Page 空态由 Document 层统一渲染。 */
  noData: never;
  /** Page 加载失败由 Document onLoadError 统一兜底；后续如需 per-page 错误监听再单独评估。 */
  onLoadError: never;
  /** 收敛为内部 `pageProxyMap` 写入逻辑（用于自适应 fit）；业务不应直接覆盖。 */
  onLoadSuccess: never;
  /** 与 pageNumber 二选一；组件以 pageNumber 管理。 */
  pageIndex: never;
  /** 组件以 currentPage 状态管理，禁止业务直接绕过。 */
  pageNumber: never;
  /** 业务覆盖会破坏 Document context 注入；不允许覆盖。 */
  pdf: never;
  /** 内部固定为 `canvas`。 */
  renderMode: never;
  /** 收敛为内部 state + `ref.rotate(deg?)`。 */
  rotate: never;
  /** 收敛为内部 scale state + ref API（`zoomIn`/`fitWidth` 等）。 */
  scale: never;
  /** Page 宽度由 scale + 旋转推导，不允许直接指定。 */
  width: never;
}

/**
 * @title ManagedPageKeys
 * @zh 被 `PdfPreviewer` 接管的 `react-pdf` Page props key 联合，参见 {@link ManagedPageKeyHints}。
 */
export type ManagedPageKeys = keyof ManagedPageKeyHints;

/**
 * @title PdfPreviewerDocumentEscapeProps
 * @zh `documentProps` 逃生通道实际接受的 `react-pdf` Document props 类型
 */
export type PdfPreviewerDocumentEscapeProps = Omit<
  DocumentProps,
  ManagedDocumentKeys
>;

/**
 * @title PdfPreviewerPageEscapeProps
 * @zh `pageProps` 逃生通道实际接受的 `react-pdf` Page props 类型
 */
export type PdfPreviewerPageEscapeProps = Omit<PageProps, ManagedPageKeys>;

/**
 * @title PdfPreviewerProps
 * @zh PDF 预览器组件参数
 */
export interface PdfPreviewerProps {
  /**
   * @zh PDF 文件数据
   * @description 与 `react-pdf` 的 `Document.file` 保持一致，支持 URL 字符串、带请求参数的对象、File / Blob / ArrayBuffer / Uint8Array
   */
  file?: DocumentProps["file"];
  /**
   * @zh pdfjs worker 地址
   */
  workerSrc: string;
  /**
   * @zh 初始页码（1-based）
   * @default 1
   */
  initialPage?: number;
  /**
   * @zh 初始适配布局
   * @default "page-width"
   * @description 非受控默认值，仅用于首次渲染与文件变更后的会话初始化；传数字时表示固定缩放倍率，不传时默认适配宽度
   */
  layout?: PdfLayout;
  /**
   * @zh 最小缩放倍率
   * @default 0.25
   */
  minScale?: number;
  /**
   * @zh 最大缩放倍率
   * @default 4
   */
  maxScale?: number;
  /**
   * @zh 每次缩放步长
   * @default 0.2
   */
  scaleStep?: number;
  /**
   * @zh 容器宽度
   * @default "100%"
   */
  width?: string | number;
  /**
   * @zh 容器高度
   * @default "100%"
   */
  height?: string | number;
  /**
   * @zh 是否展示内置工具栏，或按粒度关闭某些能力
   * @default true
   */
  toolbar?: boolean | PdfToolbarConfig;
  /**
   * @zh 高亮列表
   * @default undefined
   * @description 传入后会在对应页面 canvas 上叠加高亮层，支持两种通道：
   *   - `regions`：与 `onTextSelect` 输出对称的百分比 region 列表（业务侧持久化后原样回传即可）
   *   - `keyword`：文本关键字 / 正则，通过 customTextRenderer 包 `<mark>`
   */
  highlights?: PdfHighlight[];
  /**
   * @zh `highlights` 首条 id 变化时是否自动滚动到对应位置
   * @default true
   * @description 用于「点击引用 → 跳转高亮」类场景；首条 id 不变（如尾部追加 / 内容微调）不触发，避免打断阅读。
   *   关闭后业务可继续用 `ref.scrollToHighlight(id)` 手动驱动
   */
  autoScrollToFirstHighlight?: boolean;
  /**
   * @zh 高亮点击回调
   * @default undefined
   */
  onHighlightClick?: (payload: PdfHighlightClickPayload) => void;
  /**
   * @zh 划词工具栏渲染
   * @default undefined
   * @description 传入后开启划词浮层，用户在 PDF 上选中文本时回调此函数渲染浮层 UI；
   * 不传或返回 falsy 则不显示浮层。工具栏的 UI 与业务交互完全由调用方掌控
   */
  renderSelectionToolbar?: (payload: PdfSelectionToolbarPayload) => ReactNode;
  /**
   * @zh 文本选区变化回调
   * @default undefined
   * @description `null` 表示选区被清空（例如点击空白、点击 close、文档切换等场景）
   */
  onTextSelect?: (payload: PdfSelectionPayload | null) => void;
  /**
   * @zh 自定义下载处理
   * @default undefined
   * @description 传入后优先使用业务侧下载逻辑，组件内置下载仅作为兜底方案
   */
  onDownload?: (payload: PdfDownloadPayload) => void | Promise<void>;
  /**
   * @zh 侧边栏初始展示类型（非受控）
   * @default null
   * @description 仅作为首次渲染的默认值；运行时通过工具栏或 ref `setSidebar` 切换
   */
  defaultSidebar?: PdfSidebarType;
  /**
   * @zh 侧边栏宽度（px）
   * @default 200
   */
  sidebarWidth?: number;
  /**
   * @zh 侧边栏切换回调
   * @default undefined
   */
  onSidebarChange?: (next: PdfSidebarType) => void;
  /**
   * @zh 工具栏右侧扩展渲染
   * @default undefined
   * @description 用于插入业务侧自定义按钮或操作
   */
  toolbarExtraRender?: (payload: PdfToolbarRenderPayload) => ReactNode;
  /**
   * @zh 文件解析中提示
   * @default "文件解析中..."
   */
  loadingText?: ReactNode;
  /**
   * @zh 文件解析失败提示
   * @default "文件解析失败"
   */
  errorText?: ReactNode;
  /**
   * @zh 空态文案
   * @default "暂无 PDF 数据"
   */
  emptyText?: ReactNode;
  /**
   * @zh 文件解析成功回调
   */
  onLoadSuccess?: (payload: PdfLoadSuccessPayload) => void;
  /**
   * @zh 文件解析失败回调
   */
  onLoadError?: DocumentProps["onLoadError"];
  /**
   * @zh 页码变化回调
   */
  onPageChange?: (page: number) => void;
  /**
   * @zh 缩放变化回调
   */
  onScaleChange?: (scale: number) => void;
  /**
   * @zh 透传给 `react-pdf` Document 的 props
   * @description 已被组件接管的字段（参见 {@link ManagedDocumentKeyHints}）在类型上禁用，不可覆盖。
   *   PDF.js 的 `options`（`cMapUrl` / `wasmUrl` / `httpHeaders` / `password` 等）请通过 `documentProps.options` 传入，
   *   并定义在组件外部或用 `useMemo` 缓存，避免每次重渲染都重新加载 PDF。
   */
  documentProps?: PdfPreviewerDocumentEscapeProps;
  /**
   * @zh 透传给 `react-pdf` Page 的 props
   * @description 已被组件接管的字段（参见 {@link ManagedPageKeyHints}）在类型上禁用，不可覆盖。
   *   `customTextRenderer` / `onRenderSuccess` 会与组件内部逻辑串行叠加（先组件、后业务），其余字段直接透传。
   */
  pageProps?: PdfPreviewerPageEscapeProps;
  style?: CSSProperties;
  className?: string;
}

export interface PdfPreviewerRef {
  /** 跳转到指定页码（1-based） */
  goToPage: (page: number) => void;
  /** 下一页 */
  nextPage: () => void;
  /** 上一页 */
  prevPage: () => void;
  /** 放大一个步长 */
  zoomIn: () => void;
  /** 缩小一个步长 */
  zoomOut: () => void;
  /** 设置任意倍率 */
  setScale: (scale: number) => void;
  /** 适配宽度 */
  fitWidth: () => void;
  /** 适配高度 */
  fitHeight: () => void;
  /** 整页适配（宽高取小） */
  fitPage: () => void;
  /** 顺时针旋转，默认 +90°；传入绝对度数（0/90/180/270）则直接设置 */
  rotate: (deg?: 0 | 90 | 180 | 270) => void;
  /** 切换全屏 */
  toggleFullscreen: () => void;
  /** 滚动到指定高亮（通过 id 命中） */
  scrollToHighlight: (id: string) => void;
  /** 获取 pdfjs PDFDocumentProxy 实例 */
  getPdfInstance: () => unknown | null;
  /** 设置侧边栏类型（`null` 表示关闭） */
  setSidebar: (type: PdfSidebarType) => void;
}

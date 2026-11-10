import type { AnyExtension, Editor } from "@tiptap/core";
import type { CSSProperties, ReactNode } from "react";

/**
 * @zh 内容格式
 * @description `html` 返回/接收 HTML 字符串；`markdown` 返回/接收 Markdown 字符串；`json` 返回 TipTap JSON 字符串
 */
export type ContentType = "html" | "markdown" | "json";

/**
 * @zh 工具栏模式
 * @description `fixed` 为固定顶部工具栏；`bubble` 为随选区浮动的气泡工具栏
 */
export type ToolbarMode = "fixed" | "bubble";

/** Controls document-only editor capabilities. Omitted capabilities stay enabled. */
export interface MarkdownEditorFeatures {
  blockDrag?: boolean;
  blockMenu?: boolean;
  codeBlock?: boolean;
}

/** Controls where editor-owned floating UI is mounted. */
export interface MarkdownEditorPopupConfig {
  getContainer?: (trigger: HTMLElement) => HTMLElement;
}

export enum MenuType {
  Toolbar = "toolbar",
  TableCell = "table-cell",
  TableColumn = "table-column",
  TableRow = "table-row",
}

export enum RewriteActionType {
  Polish = "polish",
  Expansion = "expansion",
  Abbreviation = "abbreviation",
  ChatInDoc = "chat_in_doc",
}

export interface AiPolishTextBlock {
  content: string;
  type: string;
}

export interface AiPolishRequest {
  action: RewriteActionType;
  command: string;
  selectedContent: AiPolishTextBlock[];
}

/**
 * @zh AI 润色回调
 * @description 入参包含当前动作、用户指令和选中文本块；由业务侧发起 SSE 请求并返回 ReadableStream，编辑器内部负责流式读取、渲染和中断。每个 SSE event 的 `content` 会被顺序拼接，最终结果必须是与 `selectedContent` 等长的 `[{ content, type }]` JSON 数组
 */
export type AiPolishCallback = (
  request: AiPolishRequest,
  /** @zh 中断信号，业务侧应透传给 fetch 的 signal 参数 */
  signal: AbortSignal,
) => Promise<ReadableStream<Uint8Array> | null>;

/**
 * @title MarkdownEditorProps
 * @zh Markdown / 富文本编辑器参数
 * @description 基于 TipTap 封装，支持 HTML、Markdown、JSON 三种内容格式，以及气泡工具栏、固定工具栏、表格、代码块、AI 润色等能力
 */
export interface MarkdownEditorProps {
  /**
   * Floating UI boundary override for iframe or custom clipping integrations.
   * Dialog and Sheet layers are discovered automatically.
   */
  popupConfig?: MarkdownEditorPopupConfig;
  /**
   * @zh 受控内容值
   * @default undefined
   * @description 传入后由外部驱动编辑器内容；`value` 变化时会同步到内部编辑器实例。内容格式由 `contentType` 决定
   */
  value?: string;
  /**
   * @zh 非受控初始内容
   * @default undefined
   * @description 未传 `value` 时使用；仅在初始化时生效，后续不再自动同步
   */
  defaultValue?: string;
  /** Placeholder shown by TipTap while the editable document is empty. */
  placeholder?: string;
  /**
   * @zh 内容格式
   * @default "html"
   * @description 决定 `value` / `defaultValue` / `onChange` 的输入输出格式，同时影响部分功能行为，例如 Markdown 模式下表格菜单和 mark 组合能力会有所收敛
   */
  contentType?: ContentType;
  /**
   * @zh 工具栏模式
   * @default "bubble"
   * @description `fixed` 显示顶部固定工具栏；`bubble` 在选中文本时显示气泡工具栏
   */
  toolbarMode?: ToolbarMode;
  /**
   * @zh 内容更新回调
   * @default undefined
   * @description 编辑器内容变化时触发，`value` 为按 `contentType` 序列化后的结果
   */
  onChange?: (value: string) => void;
  /**
   * @zh 是否可编辑
   * @default false
   * @description 为 `false` 时进入只读模式；工具栏、拖拽与部分交互能力会自动隐藏或禁用
   */
  editable?: boolean;
  /**
   * @zh 根容器类名
   * @default undefined
   * @description 追加在编辑器根节点上，用于业务侧样式扩展
   */
  className?: string;
  /**
   * @zh 根容器样式
   * @default undefined
   */
  style?: CSSProperties;
  /**
   * @zh 追加 TipTap 扩展
   * @default []
   * @description 在组件内置扩展之后合并，用于追加不同名的自定义 node、mark 或 plugin。内置能力通过 `features` 配置，不支持同名扩展覆盖
   */
  extensions?: AnyExtension[];
  /** Disable document-only tools for compact prompt editing. */
  features?: MarkdownEditorFeatures;
  /**
   * @zh AI 润色回调
   * @default undefined
   * @description 传入后在气泡工具栏展示 AI 改写入口，并在用户触发操作时调用
   */
  onAiPolish?: AiPolishCallback;
  /**
   * @zh 图片加载器
   * @default undefined
   * @description 传入后可在图片节点渲染或替换时对原始 `src` 做异步转换，例如鉴权、签名地址替换、下载转存等
   */
  imageLoader?: (src: string) => Promise<string>;
  onUpload?: (file: File) => Promise<string>;
  /**
   * @zh 自动滚动到底部
   * @default undefined
   * @description 当内容高度持续增长且当前视口位于底部附近时，自动滚动到底部，适用于 SSE / 流式输出场景
   */
  autoScrollToBottom?: boolean;
  /**
   * @zh 工具栏扩展渲染函数
   * @default undefined
   * @description 传入 render 函数，接收当前 TipTap Editor 实例作为参数，返回 ReactNode；渲染在工具栏末尾（固定工具栏和气泡工具栏均生效），可用于注入业务自定义按钮或操作区
   */
  toolbarRender?: (editor: Editor) => ReactNode;
  /**
   * @zh 懒加载占位文案
   * @default "编辑器加载中..."
   * @description 组件内部的编辑器以懒加载方式引入，首次加载期间在容器内展示该占位文案
   */
  loadingText?: ReactNode;
}

export interface MarkdownEditorRef {
  editor: Editor | null;
}

export type { Editor };

import { AnyExtension, Editor } from "@tiptap/core";
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

/**
 * @zh AI 润色回调
 * @description 入参包含当前动作、用户指令和选中文本块；由业务侧发起 SSE 请求并返回 ReadableStream，编辑器内部负责流式读取、渲染和中断
 */
export type AiPolishCallback = (
  config: {
    /** @zh 改写动作类型 */
    action: RewriteActionType;
    /** @zh 用户补充指令 */
    command: string;
    /** @zh 当前选中的内容块 */
    selected_content: { content: string; type: string }[];
  },
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
  /**
   * @zh 内容格式
   * @default "html"
   * @description 决定 `value` / `defaultValue` / `onChange` 的输入输出格式，同时影响部分功能行为，例如 Markdown 模式下表格菜单和 mark 组合能力会有所收敛
   */
  contentType?: ContentType;
  /**
   * @zh Markdown 模式下是否解析 HTML
   * @default true
   * @description 仅在 `contentType="markdown"` 时生效。为 `true` 时，Markdown 中内嵌 HTML 会按当前默认行为解析为节点；为 `false` 时，HTML 会转义后按字面文本显示
   */
  parseHtml?: boolean;
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
   * @description 在组件内置扩展之后合并，可用于追加自定义 node、mark、plugin 或覆写默认行为
   */
  extensions?: AnyExtension[];
  /**
   * @zh 是否开启 AI 能力
   * @default false
   * @description 开启后展示 AI 相关入口（如润色、扩写、缩写等）
   */
  aiEnable?: boolean;
  /**
   * @zh 是否开启评论能力
   * @default false
   * @description 开启后展示评论相关入口，并允许对选区进行评论标注
   */
  commentEnable?: boolean;
  /**
   * @zh AI 润色回调
   * @default undefined
   * @description 当用户触发 AI 改写动作时调用；若未传则仅展示入口但不会真正执行外部改写
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

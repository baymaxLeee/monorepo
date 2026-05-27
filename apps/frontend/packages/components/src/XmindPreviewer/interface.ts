import type { CSSProperties, ReactNode } from "react";

export type XMindLayout =
  | "logicalStructure"
  | "logicalStructureLeft"
  | "mindMap"
  | "organizationStructure"
  | "catalogOrganization"
  | "timeline"
  | "timeline2"
  | "verticalTimeline"
  | "verticalTimeline2"
  | "verticalTimeline3"
  | "fishbone"
  | "fishbone2"
  | "rightFishbone"
  | "rightFishbone2";

export interface XMindThemeConfig {
  [key: string]: any;
}

export interface XMindNodeData {
  text: string;
  expand?: boolean;
  [key: string]: any;
}

export interface XMindNode {
  data: XMindNodeData;
  children?: XMindNode[];
  [key: string]: any;
}

export interface XMindFullData {
  root: XMindNode;
  layout?: XMindLayout;
  theme?: {
    template?: string;
    config?: XMindThemeConfig;
  };
  view?: Record<string, any>;
}

export interface XMindPreviewerRef {
  fit: () => void;
  resize: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getInstance: () => any | null;
  getData: (withConfig?: boolean) => XMindNode | XMindFullData | null;
}

/**
 * @title XMindPreviewerProps
 * @zh XMind 脑图预览器参数
 */
export interface XMindPreviewerProps {
  /**
   * @zh 脑图数据
   * @default undefined
   * @description 支持传入 simple-mind-map 的纯节点数据，或包含布局、主题、视图信息的完整数据。未传 `file` / `src` 时直接使用该数据渲染
   */
  data?: XMindNode | XMindFullData;
  /**
   * @zh XMind 文件对象
   * @default undefined
   * @description 传入 `.xmind` 文件或 Blob 后，组件会自动解析并预览。优先级高于 `data`
   */
  file?: File | Blob | null;
  /**
   * @zh XMind 文件地址
   * @default undefined
   * @description 传入可访问的 `.xmind` 文件 URL 后，组件会自动拉取并解析。优先级低于 `file`，高于 `data`
   */
  src?: string;
  /**
   * @zh 根容器高度
   * @default undefined
   * @description 未传时使用组件自身的最小高度兜底。业务侧如需更高展示区，可显式传入高度
   */
  height?: string | number;
  /**
   * @zh 根容器宽度
   * @default "100%"
   */
  width?: string | number;
  /**
   * @zh 只读预览
   * @default true
   */
  readonly?: boolean;
  /**
   * @zh 布局类型
   * @default "logicalStructure"
   * @description 当 `data` 传入完整数据且包含 `layout` 时，优先使用完整数据内的布局配置
   */
  layout?: XMindLayout;
  /**
   * @zh 主题名
   * @default "default"
   * @description 当 `data` 传入完整数据且包含 `theme.template` 时，优先使用完整数据内的主题配置
   */
  theme?: string;
  /**
   * @zh 自定义主题配置
   * @default undefined
   */
  themeConfig?: XMindThemeConfig;
  /**
   * @zh 初始和数据变化后自动适配视口
   * @default true
   */
  fit?: boolean;
  /**
   * @zh 是否允许节点展开/收起
   * @default true
   */
  collapsible?: boolean;
  /**
   * @zh 鼠标滚轮缩放
   * @default true
   */
  zoomable?: boolean;
  /**
   * @zh 是否展示内置预览工具栏
   * @default true
   */
  toolbar?: boolean;
  /**
   * @zh 空态文案
   * @default "暂无脑图数据"
   */
  emptyText?: ReactNode;
  /**
   * @zh 文件解析中提示
   * @default "脑图文件解析中..."
   */
  loadingText?: ReactNode;
  /**
   * @zh 文件解析失败提示
   * @default "脑图文件解析失败"
   */
  errorText?: ReactNode;
  /**
   * @zh 环境不支持预览时的文案
   * @default "当前环境暂不支持脑图预览"
   */
  unsupportedText?: ReactNode;
  /**
   * @zh 预览器就绪回调
   * @default undefined
   */
  onReady?: (instance: any) => void;
  /**
   * @zh 节点点击回调
   * @default undefined
   */
  onNodeClick?: (payload: {
    node: any;
    data: XMindNodeData | undefined;
    event: MouseEvent;
  }) => void;
  /**
   * @zh XMind 解析成功回调
   * @default undefined
   */
  onParseSuccess?: (data: XMindNode) => void;
  /**
   * @zh XMind 解析失败回调
   * @default undefined
   */
  onParseError?: (error: Error) => void;
  style?: CSSProperties;
  className?: string;
}

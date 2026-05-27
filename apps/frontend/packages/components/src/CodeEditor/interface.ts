import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { CSSProperties, ReactNode } from "react";

/**
 * @title CodeEditorProps
 * @zh CodeMirror 编辑器参数
 */
export interface CodeEditorProps {
  /**
   * @zh 缓存分组 id
   * @default undefined
   * @description 传入后会为不同 `fileId` 缓存各自的编辑状态与滚动位置，适合多标签文件编辑场景；不传时按单文档模式工作。显式传 `null` 时展示空编辑器
   */
  fileId?: string | null;
  /**
   * @zh 编辑器内容
   * @default ""
   * @description 当前文档文本内容；外部值变化会同步到编辑器
   */
  value?: string;
  /**
   * @zh 文件名
   * @default ""
   * @description 用于推断语言高亮，例如 `.ts`、`.json`、`.md`
   */
  fileName?: string;
  /**
   * @zh 内容变更回调
   * @default undefined
   */
  onChange?: (value: string) => void;
  /**
   * @zh 保存快捷键回调
   * @default undefined
   * @description 当编辑器聚焦时按下 `Ctrl/⌘ + S` 触发；未传入时不拦截浏览器默认保存行为
   */
  onSave?: (value: string, view: EditorView) => void;
  /**
   * @zh 只读
   * @default false
   */
  readOnly?: boolean;
  /**
   * @zh 追加 CodeMirror 扩展
   * @default []
   * @description 建议业务侧保持引用稳定（如提到组件外或配合 `useMemo`），避免因每次 render 传入新数组而触发编辑器重复 reconfigure
   */
  extensions?: Extension;
  /**
   * @zh 自定义文件后缀与语言扩展映射
   * @default {}
   * @description 用于覆盖或补充内置后缀语言映射；key 为文件后缀（不含 `.`），value 返回对应 CodeMirror `Extension`。建议业务侧保持引用稳定（如提到组件外或配合 `useMemo`），避免重复触发语言扩展重配置
   */
  langMapExtensions?: Record<string, () => Extension>;
  /**
   * @zh 懒加载占位文案
   * @default "编辑器加载中..."
   * @description 组件内部的 CodeMirror 编辑器以懒加载方式引入，首次加载期间在容器内展示该占位文案
   */
  loadingText?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

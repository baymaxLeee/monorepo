import type { CSSProperties, ReactNode } from "react";
import type { CodeEditorProps } from "../CodeEditor/interface";

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "directory";
  /**
   * @zh 父节点 id
   * @default undefined
   * @description 根级节点一般为 `null` 或不传
   */
  parent_id?: string | null;
  /**
   * @zh 文件文本内容
   * @default undefined
   * @description 简易模式可初始化即带值；未带且提供 `onLoadContent` 时懒加载填充。`type: 'directory'` 通常无此字段
   */
  content?: string;
  /**
   * @zh 子节点列表
   * @default undefined
   * @description 仅目录节点使用；无子时可传 `[]` 或 `null`
   */
  children?: FileNode[] | null;
}

export enum ChangeAction {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  MOVE = "move",
  RENAME = "rename",
}

export interface BaseFileChange {
  action: ChangeAction;
  id: string;
}

export interface FileChangeCreate extends BaseFileChange {
  action: ChangeAction.CREATE;
  parent_id: string | null;
  name: string;
  type: "file" | "directory";
  content?: string;
}

export interface FileChangeDelete extends BaseFileChange {
  action: ChangeAction.DELETE;
}

export interface FileChangeRename extends BaseFileChange {
  action: ChangeAction.RENAME;
  name: string;
}

export interface FileChangeMove extends BaseFileChange {
  action: ChangeAction.MOVE;
  parent_id: string | null;
}

export interface FileChangeUpdate extends BaseFileChange {
  action: ChangeAction.UPDATE;
  content: string;
}

export interface FileTab {
  id: string;
  name: string;
}

export type FileChange =
  | FileChangeCreate
  | FileChangeDelete
  | FileChangeRename
  | FileChangeMove
  | FileChangeUpdate;

export interface FileWorkspaceRef {
  /** 获取当前完整文件树 */
  getTree: () => FileNode[];
  /** 对比基线树与当前树，返回最小变更集 */
  getChanges: () => FileChange[];
  /** 将当前树设为新的基线（保存成功后调用，避免重复上报已保存的变更） */
  resetBaseline: () => void;
}

/**
 * @title FileWorkspaceProps
 * @zh 文件工作区（目录树 + 多标签编辑器）参数
 * @description 内部实现默认：侧栏初始宽度 240px
 */
export interface FileWorkspaceProps {
  /**
   * @zh 受控文件树
   * @default undefined
   * @description 传入后由外部驱动树数据；`value` 引用变化时会重置编辑器内部状态（选中、已开 Tab、懒加载缓存等）。未传时回退到 `defaultValue`，二者皆无时内部初始树为 `[]`
   */
  value?: FileNode[];
  /**
   * @zh 非受控初始文件树
   * @default []
   * @description 未传 `value` 时使用；可与 `defaultSelectedFileId` 配合默认展开并选中某文件
   */
  defaultValue?: FileNode[];
  /**
   * @zh 初始选中的文件节点 id
   * @default undefined
   * @description 挂载后会尝试打开该文件（需为 `type: 'file'` 的节点）；可与受控或非受控树一起使用
   */
  defaultSelectedFileId?: string | null;
  /**
   * @zh 懒加载文件内容
   * @default undefined
   * @description 当某文件节点尚无 `content` 且被打开时调用，返回文件文本；未传则仅使用树里已带的 `content`
   */
  onLoadContent?: (id: string) => Promise<string>;
  /**
   * @zh 树或编辑器内容变更回调
   * @default undefined
   * @description `change` 为单次操作说明；`tree` 为当前完整文件树。树操作（新建/删除/重命名/移动）与编辑文件内容变更都会触发对应的 change 事件
   */
  onChange?: (change: FileChange, tree: FileNode[]) => void;
  /**
   * @zh 根容器高度
   * @default "100%"
   * @description 传入字符串如 `"400px"`、`"100%"` 或数字（通常需业务自行加单位时仍建议用字符串）
   */
  height?: string | number;
  /**
   * @zh 只读
   * @default false
   * @description 为 `true` 时隐藏树侧新建/重命名/删除等操作，编辑器不可改内容
   */
  readOnly?: boolean;
  /**
   * @zh 根容器类名
   * @default undefined
   * @description 追加在 `file-workspace` 根节点上，可传字符串或字符串数组
   */
  className?: string | string[];
  /**
   * @zh 根容器样式
   * @default undefined
   */
  style?: CSSProperties;
  /**
   * @zh 透传给 CodeEditor 的额外参数
   * @default undefined
   * @description 类型与 `CodeEditorProps` 保持一致；其中 `fileId`、`value`、`fileName`、`onChange`、`readOnly` 由工作区内部控制，外部传入会被忽略。若传入 `extensions`、`langMapExtensions`、`onSave` 等配置，建议业务侧保持引用稳定（如提到组件外或配合 `useMemo`），避免内部编辑器重复 reconfigure
   */
  codeEditorProps?: Omit<
    CodeEditorProps,
    "fileId" | "value" | "fileName" | "onChange" | "readOnly"
  >;
  /**
   * @zh 懒加载占位文案
   * @default "工作区加载中..."
   * @description 组件内部的文件工作区以懒加载方式引入，首次加载期间在容器内展示该占位文案
   */
  loadingText?: ReactNode;
}

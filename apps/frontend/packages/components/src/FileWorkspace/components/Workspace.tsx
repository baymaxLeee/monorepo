import type React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "shared";
import {
  ChangeAction,
  type FileChange,
  type FileNode,
  type FileTab,
  type FileWorkspaceProps,
  type FileWorkspaceRef,
} from "../interface";
import { buildNodeMap, cloneTree, diffTree, patchNode } from "../utils";
import { EditorPanel } from "./EditorPanel";
import { FileTree } from "./FileTree";

export const FileWorkspace = forwardRef<FileWorkspaceRef, FileWorkspaceProps>(
  (
    {
      value,
      defaultValue,
      defaultSelectedFileId,
      onLoadContent,
      onChange,
      height = "100%",
      readOnly = false,
      className,
      style,
      codeEditorProps,
    },
    ref,
  ) => {
    const initialValue = value ?? defaultValue ?? [];
    const [tree, setTree] = useState<FileNode[]>(initialValue);
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const [tabs, setTabs] = useState<FileTab[]>([]);
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [sidebarWidth, setSidebarWidth] = useState(240);
    const [fileTreeKey, setFileTreeKey] = useState(0);

    const nodeMapRef = useRef(buildNodeMap(initialValue));
    const baselineRef = useRef<FileNode[]>(cloneTree(initialValue));
    const treeRef = useRef(tree);
    treeRef.current = tree;

    const loadedRef = useRef(new Set<string>());
    const resizingRef = useRef(false);

    const activeFile = activeFileId
      ? (nodeMapRef.current.get(activeFileId) ?? null)
      : null;

    const computeExpandedIds = useCallback(
      (map: Map<string, FileNode>, selectedId?: string | null) => {
        if (!selectedId) return undefined;
        const ids = new Set<string>();
        let cur = map.get(selectedId);
        while (cur?.parent_id) {
          ids.add(cur.parent_id);
          cur = map.get(cur.parent_id);
        }
        return ids;
      },
      [],
    );

    const defaultExpandedIdsRef = useRef<Set<string> | undefined>(
      computeExpandedIds(nodeMapRef.current, defaultSelectedFileId),
    );

    const init = useCallback(
      (value: FileNode[]) => {
        const newMap = buildNodeMap(value);
        nodeMapRef.current = newMap;
        baselineRef.current = cloneTree(value);
        loadedRef.current = new Set();
        defaultExpandedIdsRef.current = computeExpandedIds(
          newMap,
          defaultSelectedFileId,
        );
        setTree(value);
        setActiveFileId(null);
        setTabs([]);
        setLoadingId(null);
        setFileTreeKey((k) => k + 1);
      },
      [defaultSelectedFileId, computeExpandedIds],
    );

    const prevValueRef = useRef(value);
    useEffect(() => {
      const prevValue = prevValueRef.current;
      const isSameValue = value === prevValue;
      const isRepeatedEmptyValue =
        prevValue?.length === 0 && value?.length === 0;

      if (value === undefined || isSameValue || isRepeatedEmptyValue) {
        return;
      }
      prevValueRef.current = value;
      init(value);
    }, [value, init]);

    // ---- 打开文件 + 懒加载 ----
    const handleSelectFile = useCallback(
      async (id: string) => {
        const node = nodeMapRef.current.get(id);
        if (node?.type !== "file") return;

        setActiveFileId(id);
        setTabs((prev) =>
          prev.some((t) => t.id === id)
            ? prev
            : [...prev, { id, name: node.name }],
        );

        if (
          onLoadContent &&
          !loadedRef.current.has(id) &&
          node.content === undefined
        ) {
          loadedRef.current.add(id);
          setLoadingId(id);
          try {
            const content = await onLoadContent(id);
            // 增量更新 map，不需要全量 rebuild
            nodeMapRef.current.set(id, {
              ...nodeMapRef.current.get(id)!,
              content,
            });
            setTree((prev) => patchNode(prev, id, { content }));
            // 同步更新基线，避免「仅加载未编辑」被误判为变更
            baselineRef.current = patchNode(baselineRef.current, id, {
              content,
            });
          } catch {
            loadedRef.current.delete(id);
          } finally {
            setLoadingId((prev) => (prev === id ? null : prev));
          }
        }
      },
      // 故意保持 [] —— handleSelectFile 通过 ref / closure 抓取必要状态，
      // 不希望 onLoadContent 引用变化触发回调重建（会让传给子组件的 Tree 频繁刷新）。
      [],
    );

    useEffect(() => {
      if (defaultSelectedFileId) {
        handleSelectFile(defaultSelectedFileId);
      }
      // fileTreeKey 变化意味着 init 刚执行完，需要重新选中默认文件；
      // 不要把 defaultSelectedFileId / handleSelectFile 加进来，否则语义错位。
    }, [fileTreeKey]);

    // ---- Tab 关闭 ----
    const handleTabClose = useCallback(
      (id: string) => {
        setTabs((prev) => {
          const next = prev.filter((t) => t.id !== id);
          if (activeFileId === id) {
            setActiveFileId(next.length ? next[next.length - 1].id : null);
          }
          return next;
        });
      },
      [activeFileId],
    );

    // ---- 编辑内容：增量更新 map ----
    const handleContentChange = useCallback(
      (id: string, content: string) => {
        const node = nodeMapRef.current.get(id);
        if (node) nodeMapRef.current.set(id, { ...node, content });
        setTree((prev) => patchNode(prev, id, { content }));
        onChange?.({ action: ChangeAction.UPDATE, id, content }, tree);
      },
      // tree / onChange 通过 closure 引用；保持 callback 稳定避免下游 re-render
      [],
    );

    // ---- 树操作：按 action 增量维护 map（含父节点 children 同步） ----
    const handleTreeChange = useCallback(
      (newTree: FileNode[], change: FileChange) => {
        const map = nodeMapRef.current;
        switch (change.action) {
          case ChangeAction.CREATE: {
            const newNode: FileNode = {
              id: change.id,
              name: change.name,
              type: change.type,
              parent_id: change.parent_id,
              ...(change.type === "directory" ? { children: [] } : {}),
            };
            map.set(change.id, newNode);
            loadedRef.current.add(change.id);
            if (change.parent_id) {
              const parent = map.get(change.parent_id);
              if (parent)
                parent.children = [...(parent.children ?? []), newNode];
            }
            break;
          }
          case ChangeAction.DELETE: {
            const node = map.get(change.id);
            if (node?.parent_id) {
              const parent = map.get(node.parent_id);
              if (parent?.children) {
                parent.children = parent.children.filter(
                  (c) => c.id !== change.id,
                );
              }
            }
            const removeSubtree = (id: string) => {
              const n = map.get(id);
              map.delete(id);
              n?.children?.forEach((c) => removeSubtree(c.id));
            };
            removeSubtree(change.id);
            break;
          }
          case ChangeAction.RENAME: {
            const n = map.get(change.id);
            if (n) n.name = change.name;
            break;
          }
          case ChangeAction.MOVE: {
            const n = map.get(change.id);
            if (n) {
              if (n.parent_id) {
                const oldParent = map.get(n.parent_id);
                if (oldParent?.children) {
                  oldParent.children = oldParent.children.filter(
                    (c) => c.id !== change.id,
                  );
                }
              }
              if (change.parent_id) {
                const newParent = map.get(change.parent_id);
                if (newParent)
                  newParent.children = [...(newParent.children ?? []), n];
              }
              n.parent_id = change.parent_id;
            }
            break;
          }
        }
        setTree(newTree);
        onChange?.(change, newTree);
        setTabs((prev) => {
          let next = prev.filter((t) => map.has(t.id));
          if (change.action === ChangeAction.RENAME) {
            next = next.map((t) =>
              t.id === change.id ? { ...t, name: change.name } : t,
            );
          }
          if (activeFileId && !map.has(activeFileId)) {
            setActiveFileId(next.length ? next[next.length - 1].id : null);
          }
          return next;
        });
      },
      [activeFileId],
    );

    // ---- ref API ----
    useImperativeHandle(ref, () => ({
      getTree: () => treeRef.current,
      getChanges: () => diffTree(baselineRef.current, treeRef.current),
      resetBaseline: () => {
        baselineRef.current = cloneTree(treeRef.current);
      },
    }));

    // ---- 拖拽分割线 ----
    const handleResizeStart = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        resizingRef.current = true;
        const startX = e.clientX;
        const startW = sidebarWidth;
        const onMove = (ev: MouseEvent) => {
          if (!resizingRef.current) return;
          setSidebarWidth(
            Math.max(160, Math.min(480, startW + ev.clientX - startX)),
          );
        };
        const onUp = () => {
          resizingRef.current = false;
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      },
      [sidebarWidth],
    );

    return (
      <div
        className={cn(
          "flex h-full min-h-0 w-full overflow-hidden border bg-background text-sm text-foreground",
          "border-[oklch(0.9_0_0)]",
          className,
        )}
        style={{ height, ...style }}
      >
        <div
          className="flex shrink-0 flex-col overflow-hidden bg-background"
          style={{ width: sidebarWidth }}
        >
          <FileTree
            key={fileTreeKey}
            tree={tree}
            nodeMap={nodeMapRef.current}
            defaultExpandedIds={defaultExpandedIdsRef.current}
            activeFileId={activeFileId}
            onSelectFile={handleSelectFile}
            onTreeChange={handleTreeChange}
            readOnly={readOnly}
          />
        </div>
        <div
          className="group relative z-10 w-px shrink-0 cursor-col-resize bg-border"
          onMouseDown={handleResizeStart}
        >
          {/* hover/active 时显示 4px 蓝色指示条 */}
          <span className="pointer-events-none absolute inset-y-0 -left-px w-0.5 bg-transparent transition-colors group-hover:bg-[#1677ff] group-active:bg-[#1677ff]" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <EditorPanel
            tabs={tabs}
            activeFileId={activeFileId}
            file={activeFile}
            loading={loadingId === activeFileId && loadingId !== null}
            onTabSelect={setActiveFileId}
            onTabClose={handleTabClose}
            onContentChange={handleContentChange}
            readOnly={readOnly}
            codeEditorProps={codeEditorProps}
          />
        </div>
      </div>
    );
  },
);

FileWorkspace.displayName = "FileWorkspace";

export default FileWorkspace;

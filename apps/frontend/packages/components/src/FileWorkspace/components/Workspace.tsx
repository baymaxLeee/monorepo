import { cn } from "shared";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ChangeAction,
  type FileWorkspaceProps,
  type FileWorkspaceRef,
  type FileChange,
  type FileNode,
  type FileTab,
} from "../interface";
import {
  buildNodeMap,
  cloneTree,
  diffTree,
  fileWorkspaceClass,
  patchNode,
} from "../utils";
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
    const handleSelectFile = useCallback(async (id: string) => {
      const node = nodeMapRef.current.get(id);
      if (!node || node.type !== "file") return;

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
          baselineRef.current = patchNode(baselineRef.current, id, { content });
        } catch {
          loadedRef.current.delete(id);
        } finally {
          setLoadingId((prev) => (prev === id ? null : prev));
        }
      }
    }, []);

    useEffect(() => {
      if (defaultSelectedFileId) {
        handleSelectFile(defaultSelectedFileId);
      }
      // fileTreeKey 变化意味着 init 刚执行完，需要重新选中默认文件
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
    const handleContentChange = useCallback((id: string, content: string) => {
      const node = nodeMapRef.current.get(id);
      if (node) nodeMapRef.current.set(id, { ...node, content });
      setTree((prev) => patchNode(prev, id, { content }));
      onChange?.({ action: ChangeAction.UPDATE, id, content }, tree);
    }, []);

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
        className={cn(fileWorkspaceClass``, className)}
        style={{ height, ...style }}
      >
        <div
          className={fileWorkspaceClass`sidebar`}
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
          className={fileWorkspaceClass`resizer`}
          onMouseDown={handleResizeStart}
        />
        <div className={fileWorkspaceClass`main-panel`}>
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

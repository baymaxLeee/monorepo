import {
  FilePlus,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Search,
  X,
} from "lucide-react";
import { cn } from "shared";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { FileIcon } from "../../FileIcon";
import { Input } from "../../Input";
import { ChangeAction, type FileChange, type FileNode } from "../interface";
import { fileWorkspaceClass, isDescendant, updateTree } from "../utils";

function buildDirPath(nodeMap: Map<string, FileNode>, node: FileNode): string {
  const parts: string[] = [];
  let cur: FileNode | undefined = node.parent_id
    ? nodeMap.get(node.parent_id)
    : undefined;
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parent_id ? nodeMap.get(cur.parent_id) : undefined;
  }
  return parts.join("/");
}

function highlightMatch(text: string, keyword: string): React.ReactNode {
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const idx = lower.indexOf(kw);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className={fileWorkspaceClass`search-highlight`}>
        {text.slice(idx, idx + kw.length)}
      </span>
      {text.slice(idx + kw.length)}
    </>
  );
}

interface FileTreeProps {
  tree: FileNode[];
  nodeMap: Map<string, FileNode>;
  activeFileId: string | null;
  defaultExpandedIds?: Set<string>;
  onSelectFile: (id: string) => void;
  onTreeChange: (tree: FileNode[], change: FileChange) => void;
  readOnly?: boolean;
}

interface ContextMenu {
  x: number;
  y: number;
  targetId: string | null;
  targetType: "file" | "directory";
}

interface InlineInput {
  parent_id: string | null;
  type: "file" | "directory";
  renameId: string | null;
}

export const FileTree: React.FC<FileTreeProps> = ({
  tree,
  nodeMap,
  activeFileId,
  defaultExpandedIds,
  onSelectFile,
  onTreeChange,
  readOnly,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => defaultExpandedIds ?? new Set(),
  );
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [input, setInput] = useState<InlineInput | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState("");

  const searchResults = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    if (!kw) return null;
    const results: { node: FileNode; dirPath: string }[] = [];
    for (const [, node] of nodeMap) {
      if (node.type !== "file") continue;
      if (node.name.toLowerCase().includes(kw)) {
        results.push({ node, dirPath: buildDirPath(nodeMap, node) });
      }
    }
    results.sort((a, b) => {
      const aIdx = a.node.name.toLowerCase().indexOf(kw);
      const bIdx = b.node.name.toLowerCase().indexOf(kw);
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.node.name.localeCompare(b.node.name);
    });
    return results;
  }, [searchKeyword, nodeMap]);
  const dragSrcRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  // 点击菜单外部关闭右键菜单
  const menuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menu]);

  const toggle = useCallback((id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  // ---- Context Menu ----
  const onCtxMenu = useCallback(
    (e: React.MouseEvent, node?: FileNode) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        targetId: node?.id ?? null,
        targetType: node?.type ?? "directory",
      });
    },
    [readOnly],
  );

  // ---- Delete ----
  const handleDelete = useCallback(
    (id: string) => {
      const result = updateTree(tree, id, (_n, siblings, idx) => {
        const next = [...siblings];
        next.splice(idx, 1);
        return next;
      });
      if (result) onTreeChange(result, { action: ChangeAction.DELETE, id });
      closeMenu();
    },
    [tree, onTreeChange, closeMenu],
  );

  // ---- Create / Rename trigger ----
  const startCreate = useCallback(
    (parent_id: string | null, type: "file" | "directory") => {
      if (parent_id) setExpanded((s) => new Set(s).add(parent_id));
      setInput({ parent_id, type, renameId: null });
      closeMenu();
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [closeMenu],
  );

  const startRename = useCallback(
    (id: string) => {
      setInput({ parent_id: null, type: "file", renameId: id });
      closeMenu();
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    },
    [closeMenu],
  );

  // ---- 同级重名检测 ----
  const hasDuplicateName = useCallback(
    (parent_id: string | null, name: string, excludeId?: string): boolean => {
      const siblings = parent_id
        ? (nodeMap.get(parent_id)?.children ?? [])
        : tree;
      return siblings.some((n) => n.name === name && n.id !== excludeId);
    },
    [tree, nodeMap],
  );

  const validateName = useCallback(
    (name: string) => {
      if (!input || !name) {
        setNameError(null);
        return;
      }
      const parent_id = input.renameId
        ? (nodeMap.get(input.renameId)?.parent_id ?? null)
        : input.parent_id;
      const excludeId = input.renameId ?? undefined;
      if (hasDuplicateName(parent_id, name, excludeId)) {
        setNameError(`文件或文件夹 ${name} 在此位置已存在，请选择其他名称。`);
      } else {
        setNameError(null);
      }
    },
    [input, nodeMap, hasDuplicateName],
  );

  // ---- Commit inline input ----
  const commit = useCallback(
    (value: string) => {
      const name = value.trim();
      if (!input || !name) {
        setInput(null);
        setNameError(null);
        return;
      }

      if (input.renameId) {
        const node = nodeMap.get(input.renameId);
        if (hasDuplicateName(node?.parent_id ?? null, name, input.renameId))
          return;

        const result = updateTree(tree, input.renameId, (n, siblings, idx) => {
          const copy = [...siblings];
          copy[idx] = { ...n, name };
          return copy;
        });
        if (result)
          onTreeChange(result, {
            action: ChangeAction.RENAME,
            id: input.renameId,
            name,
          });
      } else {
        if (hasDuplicateName(input.parent_id, name)) return;

        const newNode: FileNode = {
          id: uuidv4().replace(/-/g, ""),
          name,
          type: input.type,
          parent_id: input.parent_id,
          ...(input.type === "directory" ? { children: [] } : {}),
        };
        const change: FileChange = {
          action: ChangeAction.CREATE,
          id: newNode.id,
          parent_id: input.parent_id ?? null,
          name,
          type: input.type,
        };

        if (!input.parent_id) {
          onTreeChange([...tree, newNode], change);
        } else {
          const result = updateTree(
            tree,
            input.parent_id,
            (node, siblings, idx) => {
              const copy = [...siblings];
              copy[idx] = {
                ...node,
                children: [...(node.children ?? []), newNode],
              };
              return copy;
            },
          );
          if (result) onTreeChange(result, change);
        }
        if (newNode.type === "file") onSelectFile(newNode.id);
      }
      setInput(null);
      setNameError(null);
    },
    [input, tree, onTreeChange, onSelectFile, nodeMap, hasDuplicateName],
  );

  // ---- Drag & Drop ----
  const onDragStart = useCallback((e: React.DragEvent, id: string) => {
    dragSrcRef.current = id;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, node: FileNode) => {
    if (node.type !== "directory") return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(node.id);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent, targetId: string | null) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverId(null);
      const srcId = dragSrcRef.current;
      if (!srcId || srcId === targetId) return;

      // 只允许拖入目录或根级
      if (targetId !== null) {
        const target = nodeMap.get(targetId);
        if (!target || target.type !== "directory") return;
      }

      // 同层级拖拽，不改变位置
      const srcParentId = nodeMap.get(srcId)?.parent_id ?? null;
      if (srcParentId === targetId) return;

      // 防止把文件夹拖进自己的子目录（循环引用）
      const src = nodeMap.get(srcId);
      if (src?.type === "directory" && targetId !== null) {
        if (isDescendant(src, targetId)) return;
      }

      // 目标目录下重名检测
      if (src && hasDuplicateName(targetId, src.name, srcId)) {
        toast.warning(
          `目标位置已存在同名文件或文件夹「${src.name}」，无法移动`,
        );
        return;
      }

      let movedNode: FileNode | null = null;
      const afterRemove = updateTree(tree, srcId, (node, siblings, idx) => {
        movedNode = node;
        const next = [...siblings];
        next.splice(idx, 1);
        return next;
      });
      if (!afterRemove || !movedNode) return;

      const change: FileChange = {
        action: ChangeAction.MOVE,
        id: srcId,
        parent_id: targetId,
      };

      if (targetId === null) {
        onTreeChange([...afterRemove, movedNode], change);
        return;
      }

      const result = updateTree(
        afterRemove,
        targetId,
        (node, siblings, idx) => {
          const copy = [...siblings];
          copy[idx] = {
            ...node,
            children: [...(node.children ?? []), movedNode!],
          };
          return copy;
        },
      );
      if (result) {
        setExpanded((s) => new Set(s).add(targetId));
        onTreeChange(result, change);
      }
    },
    [tree, nodeMap, onTreeChange, hasDuplicateName],
  );

  // ---- Render helpers ----
  const renderInput = (defaultValue = "") => (
    <div className={fileWorkspaceClass`inline-input-wrapper`}>
      <input
        ref={inputRef}
        className={cn(fileWorkspaceClass`inline-input`, {
          error: !!nameError,
        })}
        defaultValue={defaultValue}
        onChange={(e) => validateName(e.target.value.trim())}
        onBlur={(e) => {
          if (nameError) {
            setInput(null);
            setNameError(null);
          } else {
            commit(e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !nameError)
            commit((e.target as HTMLInputElement).value);
          if (e.key === "Escape") {
            setInput(null);
            setNameError(null);
          }
        }}
      />
      {nameError && (
        <div className={fileWorkspaceClass`name-error-tip`}>{nameError}</div>
      )}
    </div>
  );

  const renderNode = (node: FileNode, depth: number) => {
    const isDir = node.type === "directory";
    const isOpen = expanded.has(node.id);
    const isRenaming = input?.renameId === node.id;

    return (
      <div key={node.id}>
        <div
          className={cn(fileWorkspaceClass`tree-node`, {
            active: node.id === activeFileId,
            dragOver: dragOverId === node.id,
          })}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => (isDir ? toggle(node.id) : onSelectFile(node.id))}
          onContextMenu={(e) => onCtxMenu(e, node)}
          draggable={!readOnly}
          onDragStart={(e) => onDragStart(e, node.id)}
          onDragOver={(e) => onDragOver(e, node)}
          onDrop={isDir ? (e) => onDrop(e, node.id) : undefined}
          onDragLeave={() => setDragOverId(null)}
        >
          <span className={fileWorkspaceClass`node-icon`}>
            {isDir ? (
              isOpen ? (
                <FolderOpen className="size-4" />
              ) : (
                <FolderClosed className="size-4" />
              )
            ) : (
              <FileIcon filename={node.name} />
            )}
          </span>
          {isRenaming ? (
            renderInput(node.name)
          ) : (
            <span className={fileWorkspaceClass`node-name`}>{node.name}</span>
          )}
        </div>
        {isDir && isOpen && (
          <div
            onDragOver={(e) => onDragOver(e, node)}
            onDrop={(e) => onDrop(e, node.id)}
            onDragLeave={() => setDragOverId(null)}
          >
            {node.children?.map((c) => renderNode(c, depth + 1))}
            {input && !input.renameId && input.parent_id === node.id && (
              <div
                className={fileWorkspaceClass`tree-node`}
                style={{ paddingLeft: (depth + 1) * 16 + 8 }}
              >
                <span className={fileWorkspaceClass`node-icon`}>
                  {input.type === "directory" ? (
                    <FolderClosed className="size-4" />
                  ) : (
                    <FileIcon filename="" />
                  )}
                </span>
                {renderInput()}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className={fileWorkspaceClass`tree-header`}>
        <span className={fileWorkspaceClass`tree-title`}>目录</span>
        {!readOnly && (
          <div className={fileWorkspaceClass`tree-actions`}>
            <button
              type="button"
              className={fileWorkspaceClass`tree-action-btn`}
              onClick={() => startCreate(null, "file")}
              title="新建文件"
            >
              <FilePlus className="size-4" />
            </button>
            <button
              type="button"
              className={fileWorkspaceClass`tree-action-btn`}
              onClick={() => startCreate(null, "directory")}
              title="新建文件夹"
            >
              <FolderPlus className="size-4" />
            </button>
          </div>
        )}
      </div>

      <div className={fileWorkspaceClass`file-search`}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="h-8 pl-8 pr-7"
          />
          {searchKeyword && (
            <button
              type="button"
              aria-label="清除"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchKeyword("")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        className={fileWorkspaceClass`file-tree`}
        onContextMenu={(e) => onCtxMenu(e)}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => onDrop(e, null)}
        onClick={closeMenu}
      >
        {searchResults ? (
          <div className={fileWorkspaceClass`tree-content`}>
            {searchResults.length === 0 ? (
              <div className={fileWorkspaceClass`search-empty`}>
                未找到匹配的文件
              </div>
            ) : (
              searchResults.map(({ node, dirPath }) => (
                <div
                  key={node.id}
                  className={cn(fileWorkspaceClass`search-item`, {
                    active: node.id === activeFileId,
                  })}
                  onClick={() => onSelectFile(node.id)}
                >
                  <span className={fileWorkspaceClass`node-icon`}>
                    <FileIcon filename={node.name} />
                  </span>
                  <span className={fileWorkspaceClass`search-item-name`}>
                    {highlightMatch(node.name, searchKeyword.trim())}
                  </span>
                  {dirPath && (
                    <span className={fileWorkspaceClass`search-item-path`}>
                      {dirPath}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className={fileWorkspaceClass`tree-content`}>
            {tree.map((n) => renderNode(n, 0))}
            {input && !input.renameId && !input.parent_id && (
              <div
                className={fileWorkspaceClass`tree-node`}
                style={{ paddingLeft: 8 }}
              >
                <span className={fileWorkspaceClass`node-icon`}>
                  {input.type === "directory" ? (
                    <FolderClosed className="size-4" />
                  ) : (
                    <FileIcon filename="" />
                  )}
                </span>
                {renderInput()}
              </div>
            )}
          </div>
        )}
      </div>

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className={fileWorkspaceClass`context-menu`}
            style={{ top: menu.y, left: menu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.targetType === "directory" && (
              <>
                <div
                  className={fileWorkspaceClass`menu-item`}
                  onClick={() => startCreate(menu.targetId, "file")}
                >
                  新建文件
                </div>
                <div
                  className={fileWorkspaceClass`menu-item`}
                  onClick={() => startCreate(menu.targetId, "directory")}
                >
                  新建文件夹
                </div>
              </>
            )}
            {menu.targetId !== null && (
              <>
                <div
                  className={fileWorkspaceClass`menu-item`}
                  onClick={() => startRename(menu.targetId!)}
                >
                  重命名
                </div>
                <div
                  className={cn(fileWorkspaceClass`menu-item`, "danger")}
                  onClick={() => handleDelete(menu.targetId!)}
                >
                  删除
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

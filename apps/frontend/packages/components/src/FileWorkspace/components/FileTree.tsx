import {
  FilePlus,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Search,
  X,
} from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "shared";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { FileIcon } from "../../FileIcon";
import { Input } from "../../Input";
import { ChangeAction, type FileChange, type FileNode } from "../interface";
import { isDescendant, updateTree } from "../utils";

/* ────────────── style tokens ──────────────
 * 提取为本地常量，避免 className 拼接得太长，便于一处修改样式。
 * 颜色魔法值（#1677ff / #e8f3ff / #f3c623 等）来自原 file-workspace 视觉系统，
 * 本仓 design tokens 未直接暴露，先以 arbitrary value 保真还原。
 */
const NODE_BASE = "flex cursor-default items-center text-sm transition-colors";
const TREE_NODE_CLS =
  "h-8 gap-2 whitespace-nowrap pr-2 text-foreground hover:bg-muted";
const TREE_NODE_ACTIVE = "bg-[#e8f3ff] text-[#1677ff] hover:bg-[#e8f3ff]";
const TREE_NODE_DRAGOVER = "bg-[#d4e8ff]";
const NODE_ICON_CLS =
  "mr-1 flex shrink-0 items-center justify-center [&_svg]:size-5 [&_svg]:stroke-2 [&:has(svg.lucide-folder)]:text-[#f3c623] [&:has(svg.lucide-folder-open)]:text-[#f3c623] [&:has(svg.lucide-file-text)]:text-[#1677ff]";
const SEARCH_ITEM_CLS =
  "h-7 gap-1 whitespace-nowrap px-3 text-foreground hover:bg-muted";
const SEARCH_ITEM_ACTIVE = "bg-[#e8f3ff]";
const MENU_ITEM_CLS =
  "cursor-default px-4 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground";
const MENU_ITEM_DANGER =
  "text-[#e5484d] hover:bg-[#fff0ed] hover:text-[#e5484d]";

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
      <span className="font-semibold text-[#1677ff]">
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

      if (targetId !== null) {
        const target = nodeMap.get(targetId);
        if (target?.type !== "directory") return;
      }

      const srcParentId = nodeMap.get(srcId)?.parent_id ?? null;
      if (srcParentId === targetId) return;

      // 防止把文件夹拖进自己的子目录（循环引用）
      const src = nodeMap.get(srcId);
      if (src?.type === "directory" && targetId !== null) {
        if (isDescendant(src, targetId)) return;
      }

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

  const renderInput = (defaultValue = "") => (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        className={cn(
          "h-6 w-full rounded-sm border bg-background px-1 text-sm text-foreground outline-none",
          nameError ? "border-destructive" : "border-[#1677ff]",
        )}
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
        <div className="absolute inset-x-0 top-full z-10 mt-px break-all border border-[#be1100] bg-[#752020] px-2 py-1 text-xs leading-5 text-white">
          {nameError}
        </div>
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
          className={cn(
            NODE_BASE,
            TREE_NODE_CLS,
            node.id === activeFileId && TREE_NODE_ACTIVE,
            dragOverId === node.id && TREE_NODE_DRAGOVER,
          )}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => (isDir ? toggle(node.id) : onSelectFile(node.id))}
          onContextMenu={(e) => onCtxMenu(e, node)}
          draggable={!readOnly}
          onDragStart={(e) => onDragStart(e, node.id)}
          onDragOver={(e) => onDragOver(e, node)}
          onDrop={isDir ? (e) => onDrop(e, node.id) : undefined}
          onDragLeave={() => setDragOverId(null)}
        >
          <span className={NODE_ICON_CLS}>
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
            <span className="min-w-0 overflow-hidden text-ellipsis">
              {node.name}
            </span>
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
                className={cn(NODE_BASE, TREE_NODE_CLS)}
                style={{ paddingLeft: (depth + 1) * 16 + 8 }}
              >
                <span className={NODE_ICON_CLS}>
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
      <div className="flex h-8 shrink-0 items-center justify-between border-b bg-muted/40 px-3">
        <span className="text-sm font-medium leading-5 text-foreground">
          目录
        </span>
        {!readOnly && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-sm bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => startCreate(null, "file")}
              title="新建文件"
            >
              <FilePlus className="size-4 stroke-2" />
            </button>
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-sm bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => startCreate(null, "directory")}
              title="新建文件夹"
            >
              <FolderPlus className="size-4 stroke-2" />
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-b bg-background px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="h-9 pl-8 pr-7"
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
        className="min-h-0 flex-1 select-none overflow-hidden bg-background"
        onContextMenu={(e) => onCtxMenu(e)}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => onDrop(e, null)}
        onClick={closeMenu}
      >
        {searchResults ? (
          <div
            className={cn(
              "h-full overflow-y-auto overflow-x-hidden py-1",
              "[scrollbar-width:thin] [scrollbar-color:oklch(0.82_0_0)_transparent]",
              "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[oklch(0.82_0_0)]",
            )}
          >
            {searchResults.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                未找到匹配的文件
              </div>
            ) : (
              searchResults.map(({ node, dirPath }) => (
                <div
                  key={node.id}
                  className={cn(
                    NODE_BASE,
                    SEARCH_ITEM_CLS,
                    node.id === activeFileId && SEARCH_ITEM_ACTIVE,
                  )}
                  onClick={() => onSelectFile(node.id)}
                >
                  <span className={NODE_ICON_CLS}>
                    <FileIcon filename={node.name} />
                  </span>
                  <span className="shrink-0 text-sm">
                    {highlightMatch(node.name, searchKeyword.trim())}
                  </span>
                  {dirPath && (
                    <span className="ml-1 overflow-hidden text-ellipsis text-xs text-muted-foreground">
                      {dirPath}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div
            className={cn(
              "h-full overflow-y-auto overflow-x-hidden py-1",
              "[scrollbar-width:thin] [scrollbar-color:oklch(0.82_0_0)_transparent]",
              "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[oklch(0.82_0_0)]",
            )}
          >
            {tree.map((n) => renderNode(n, 0))}
            {input && !input.renameId && !input.parent_id && (
              <div
                className={cn(NODE_BASE, TREE_NODE_CLS)}
                style={{ paddingLeft: 8 }}
              >
                <span className={NODE_ICON_CLS}>
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
            className="fixed z-[9999] min-w-36 rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
            style={{ top: menu.y, left: menu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.targetType === "directory" && (
              <>
                <div
                  className={MENU_ITEM_CLS}
                  onClick={() => startCreate(menu.targetId, "file")}
                >
                  新建文件
                </div>
                <div
                  className={MENU_ITEM_CLS}
                  onClick={() => startCreate(menu.targetId, "directory")}
                >
                  新建文件夹
                </div>
              </>
            )}
            {menu.targetId !== null && (
              <>
                <div
                  className={MENU_ITEM_CLS}
                  onClick={() => startRename(menu.targetId!)}
                >
                  重命名
                </div>
                <div
                  className={cn(MENU_ITEM_CLS, MENU_ITEM_DANGER)}
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

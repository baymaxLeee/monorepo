import { bemClassFactory } from "../utils/bem";

export { getLanguageExtension } from "../CodeEditor/utils";

import { ChangeAction, type FileChange, type FileNode } from "./interface";

export const fileWorkspaceClass = bemClassFactory("file-workspace");

/** 递归遍历树，构建 id → FileNode 索引，同时填充每个节点的 parent_id */
export function buildNodeMap(tree: FileNode[]): Map<string, FileNode> {
  const map = new Map<string, FileNode>();
  const walk = (nodes: FileNode[], pid: string | null) => {
    for (const n of nodes) {
      n.parent_id = pid;
      map.set(n.id, n);
      if (n.children) walk(n.children, n.id);
    }
  };
  walk(tree, null);
  return map;
}

/** 深拷贝文件树，切断与原树的对象引用 */
export function cloneTree(nodes: FileNode[]): FileNode[] {
  return nodes.map((n) => ({
    ...n,
    children: n.children ? cloneTree(n.children) : undefined,
  }));
}

/**
 * 不可变树操作：在树中查找 id 节点，执行 op 回调返回新的同级数组。
 * 返回整棵新树，未找到返回 null。
 */
export function updateTree(
  tree: FileNode[],
  id: string,
  op: (node: FileNode, siblings: FileNode[], idx: number) => FileNode[],
): FileNode[] | null {
  for (let i = 0; i < tree.length; i++) {
    if (tree[i].id === id) return op(tree[i], tree, i);
    if (tree[i].children) {
      const result = updateTree(tree[i].children!, id, op);
      if (result) {
        const copy = [...tree];
        copy[i] = { ...copy[i], children: result };
        return copy;
      }
    }
  }
  return null;
}

/** 判断 targetId 是否是 node 的后代 */
export function isDescendant(node: FileNode, targetId: string): boolean {
  if (!node.children) return false;
  for (const child of node.children) {
    if (child.id === targetId || isDescendant(child, targetId)) return true;
  }
  return false;
}

/** 不可变地更新树中某个节点的字段 */
export function patchNode(
  tree: FileNode[],
  id: string,
  patch: Partial<FileNode>,
): FileNode[] {
  return tree.map((n) => {
    if (n.id === id) return { ...n, ...patch };
    if (n.children) return { ...n, children: patchNode(n.children, id, patch) };
    return n;
  });
}

/**
 * 对比基线树与当前树，生成最小 FileChange 变更集。
 * DELETE 只报告被删除子树的根节点；CREATE 按父→子排序确保可顺序重放。
 */
export function diffTree(
  oldTree: FileNode[],
  newTree: FileNode[],
): FileChange[] {
  const changes: FileChange[] = [];
  const oldMap = buildNodeMap(oldTree);
  const newMap = buildNodeMap(newTree);

  // DELETE: 只报告顶层删除（父节点也被删除时跳过子节点）
  const deletedIds = new Set<string>();
  for (const [id] of oldMap) {
    if (!newMap.has(id)) deletedIds.add(id);
  }
  for (const id of deletedIds) {
    let pid = oldMap.get(id)!.parent_id;
    let covered = false;
    while (pid) {
      if (deletedIds.has(pid)) {
        covered = true;
        break;
      }
      pid = oldMap.get(pid)?.parent_id ?? null;
    }
    if (!covered) {
      changes.push({ action: ChangeAction.DELETE, id });
    }
  }

  // CREATE: 所有新增节点，按深度排序（父先于子）
  const created: FileNode[] = [];
  for (const [id, node] of newMap) {
    if (!oldMap.has(id)) created.push(node);
  }
  const depth = (n: FileNode): number => {
    let d = 0;
    let pid = n.parent_id;
    while (pid) {
      d++;
      pid = newMap.get(pid)?.parent_id ?? null;
    }
    return d;
  };
  created.sort((a, b) => depth(a) - depth(b));
  for (const n of created) {
    changes.push({
      action: ChangeAction.CREATE,
      id: n.id,
      parent_id: n.parent_id ?? null,
      name: n.name,
      type: n.type,
      ...(n.type === "file" && n.content !== undefined
        ? { content: n.content }
        : {}),
    });
  }

  // RENAME / MOVE / UPDATE
  for (const [id, newNode] of newMap) {
    const oldNode = oldMap.get(id);
    if (!oldNode) continue;

    if (oldNode.name !== newNode.name) {
      changes.push({ action: ChangeAction.RENAME, id, name: newNode.name });
    }
    if (oldNode.parent_id !== newNode.parent_id) {
      changes.push({
        action: ChangeAction.MOVE,
        id,
        parent_id: newNode.parent_id ?? null,
      });
    }
    if (
      newNode.type === "file" &&
      oldNode.content !== undefined &&
      newNode.content !== undefined &&
      oldNode.content !== newNode.content
    ) {
      changes.push({
        action: ChangeAction.UPDATE,
        id,
        content: newNode.content,
      });
    }
  }

  return changes;
}

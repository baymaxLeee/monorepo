import { Extension } from "@tiptap/core";
import { DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

export interface BlockDragTarget {
  pos: number;
  placement: "before" | "after";
}

export interface BlockDragState {
  activeBlockPos: number | null;
  draggingBlockPos: number | null;
  dropTarget: BlockDragTarget | null;
}

interface TopLevelBlockInfo {
  pos: number;
  nodeSize: number;
  dom: HTMLElement;
}

type BlockDragMeta = Partial<BlockDragState>;

const INITIAL_STATE: BlockDragState = {
  activeBlockPos: null,
  draggingBlockPos: null,
  dropTarget: null,
};

const BLOCK_DRAG_STORAGE_KEY = "blockDrag";

function isHTMLElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

function getBlockDragMeta(tr: Transaction) {
  return tr.getMeta(BLOCK_DRAG_STORAGE_KEY) as BlockDragMeta | undefined;
}

function isTopLevelDraggable(
  view: EditorView,
  pos: number,
): TopLevelBlockInfo | null {
  const node = view.state.doc.nodeAt(pos);
  if (!node?.isBlock) return null;

  let dom = view.nodeDOM(pos);
  if (dom instanceof Text) dom = dom.parentElement;
  if (!isHTMLElement(dom)) return null;

  return {
    pos,
    nodeSize: node.nodeSize,
    dom,
  };
}

function resolveTopLevelBlockByRect(
  view: EditorView,
  y: number,
): TopLevelBlockInfo | null {
  let offset = 0;
  for (let i = 0; i < view.state.doc.childCount; i++) {
    const child = view.state.doc.child(i);
    let dom = view.nodeDOM(offset);
    if (dom instanceof Text) dom = dom.parentElement;
    if (isHTMLElement(dom)) {
      const rect = dom.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        return { pos: offset, nodeSize: child.nodeSize, dom };
      }
    }
    offset += child.nodeSize;
  }
  return null;
}

export function resolveTopLevelBlockAtCoords(
  view: EditorView,
  coords: { left: number; top: number },
): TopLevelBlockInfo | null {
  const result = view.posAtCoords(coords);
  if (result) {
    const $pos = view.state.doc.resolve(result.pos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth - 1).type.name === "doc") {
        const pos = $pos.before(depth);
        return isTopLevelDraggable(view, pos);
      }
    }
  }

  return resolveTopLevelBlockByRect(view, coords.top);
}

function getTopLevelBlockIndex(doc: EditorView["state"]["doc"], pos: number) {
  let index = -1;
  let found = -1;

  doc.forEach((_node, offset) => {
    index += 1;
    if (offset === pos) {
      found = index;
    }
  });

  return found;
}

function resolveDropTarget(
  sourcePos: number,
  target: TopLevelBlockInfo | null,
  mouseY: number,
  view: EditorView,
): BlockDragTarget | null {
  if (!target) return null;

  const sourceIndex = getTopLevelBlockIndex(view.state.doc, sourcePos);
  const targetIndex = getTopLevelBlockIndex(view.state.doc, target.pos);
  if (sourceIndex < 0 || targetIndex < 0) return null;

  const rect = target.dom.getBoundingClientRect();
  const placement: BlockDragTarget["placement"] =
    mouseY <= rect.top + rect.height / 2 ? "before" : "after";

  if (sourceIndex === targetIndex) return null;
  if (placement === "before" && sourceIndex + 1 === targetIndex) return null;
  if (placement === "after" && targetIndex + 1 === sourceIndex) return null;

  return {
    pos: target.pos,
    placement,
  };
}

function createMeta(
  next: BlockDragMeta,
  current: BlockDragState,
): BlockDragMeta | null {
  const merged: BlockDragState = {
    activeBlockPos:
      next.activeBlockPos !== undefined
        ? next.activeBlockPos
        : current.activeBlockPos,
    draggingBlockPos:
      next.draggingBlockPos !== undefined
        ? next.draggingBlockPos
        : current.draggingBlockPos,
    dropTarget:
      next.dropTarget !== undefined ? next.dropTarget : current.dropTarget,
  };

  if (
    merged.activeBlockPos === current.activeBlockPos &&
    merged.draggingBlockPos === current.draggingBlockPos &&
    merged.dropTarget?.pos === current.dropTarget?.pos &&
    merged.dropTarget?.placement === current.dropTarget?.placement
  ) {
    return null;
  }

  return next;
}

function clearDragState(view: EditorView) {
  const current =
    (
      view as EditorView & { __blockDragReadState?: () => BlockDragState }
    ).__blockDragReadState?.() ?? INITIAL_STATE;
  const meta = createMeta(
    {
      activeBlockPos: null,
      draggingBlockPos: null,
      dropTarget: null,
    },
    current,
  );
  if (!meta) return;
  view.dispatch(view.state.tr.setMeta(BLOCK_DRAG_STORAGE_KEY, meta));
}

function moveBlock(
  view: EditorView,
  sourcePos: number,
  target: BlockDragTarget,
): boolean {
  const { state } = view;
  const sourceNode = state.doc.nodeAt(sourcePos);
  if (!sourceNode) return false;

  const targetNode = state.doc.nodeAt(target.pos);
  if (!targetNode) return false;

  const sourceSlice = new Slice(Fragment.from(sourceNode), 0, 0);
  let tr = state.tr.delete(sourcePos, sourcePos + sourceNode.nodeSize);
  const mappedTargetPos = tr.mapping.map(target.pos, -1);
  const mappedTargetNode = tr.doc.nodeAt(mappedTargetPos);
  if (!mappedTargetNode) return false;

  const insertPos =
    target.placement === "before"
      ? mappedTargetPos
      : mappedTargetPos + mappedTargetNode.nodeSize;

  tr = tr.insert(insertPos, sourceSlice.content);
  tr = tr.setMeta(BLOCK_DRAG_STORAGE_KEY, {
    activeBlockPos: insertPos,
    draggingBlockPos: null,
    dropTarget: null,
  });

  view.dispatch(tr.scrollIntoView());
  return true;
}

declare module "@tiptap/core" {
  interface Storage {
    blockDrag: {
      getState: () => BlockDragState;
    };
  }

  interface Commands<ReturnType> {
    blockDrag: {
      startBlockDrag: (
        pos: number,
        dataTransfer?: DataTransfer | null,
      ) => ReturnType;
      clearBlockDrag: () => ReturnType;
      /** 用 dragover 阶段追踪到的 dropTarget 完成移动，绕过 drop 事件 */
      finishBlockDrag: () => ReturnType;
    };
  }
}

export function getBlockDragState(editor: Editor): BlockDragState {
  return editor.storage?.blockDrag?.getState?.() ?? INITIAL_STATE;
}

export const createBlockDragExtension = () => {
  const pluginKey = new PluginKey<BlockDragState>("blockDrag");
  let currentState = INITIAL_STATE;

  return Extension.create({
    name: "blockDrag",

    addStorage() {
      return {
        getState: () => currentState,
      };
    },

    addCommands() {
      return {
        startBlockDrag:
          (pos, dataTransfer) =>
          ({ editor }) => {
            const block = isTopLevelDraggable(editor.view, pos);
            if (!block) return false;

            const node = editor.state.doc.nodeAt(pos);
            if (!node) return false;

            editor.view.dispatch(
              editor.state.tr
                .setSelection(NodeSelection.create(editor.state.doc, pos))
                .setMeta(BLOCK_DRAG_STORAGE_KEY, {
                  activeBlockPos: pos,
                  draggingBlockPos: pos,
                  dropTarget: null,
                }),
            );

            if (dataTransfer) {
              const slice = new Slice(Fragment.from(node), 0, 0);
              const serializer = DOMSerializer.fromSchema(editor.state.schema);
              const fragment = serializer.serializeFragment(slice.content);
              const wrapper = document.createElement("div");
              wrapper.appendChild(fragment);

              dataTransfer.clearData();
              dataTransfer.effectAllowed = "move";
              dataTransfer.setData("text/html", wrapper.innerHTML);
              dataTransfer.setData("text/plain", node.textContent);
              dataTransfer.setDragImage(block.dom, 0, 0);
              (editor.view as EditorView & { dragging?: unknown }).dragging = {
                move: true,
                slice,
              };
            }

            return true;
          },

        clearBlockDrag:
          () =>
          ({ editor }) => {
            clearDragState(editor.view);
            return true;
          },

        finishBlockDrag:
          () =>
          ({ editor }) => {
            const state = currentState;
            if (state.draggingBlockPos == null || !state.dropTarget) {
              clearDragState(editor.view);
              return false;
            }
            const moved = moveBlock(
              editor.view,
              state.draggingBlockPos,
              state.dropTarget,
            );
            if (!moved) {
              clearDragState(editor.view);
            }
            return moved;
          },
      };
    },

    addProseMirrorPlugins() {
      return [
        new Plugin<BlockDragState>({
          key: pluginKey,
          state: {
            init: () => INITIAL_STATE,
            apply(tr, pluginState) {
              const meta = getBlockDragMeta(tr);
              if (!meta) {
                currentState = pluginState;
                return pluginState;
              }

              const nextState = {
                activeBlockPos:
                  meta.activeBlockPos !== undefined
                    ? meta.activeBlockPos
                    : pluginState.activeBlockPos,
                draggingBlockPos:
                  meta.draggingBlockPos !== undefined
                    ? meta.draggingBlockPos
                    : pluginState.draggingBlockPos,
                dropTarget:
                  meta.dropTarget !== undefined
                    ? meta.dropTarget
                    : pluginState.dropTarget,
              };
              currentState = nextState;
              return nextState;
            },
          },
          props: {
            handleDrop(view, event) {
              const dragState = currentState;
              if (dragState.draggingBlockPos == null) return false;

              event.preventDefault();
              const editorRect = view.dom.getBoundingClientRect();
              const block =
                resolveTopLevelBlockAtCoords(view, {
                  left: editorRect.left + 24,
                  top: event.clientY,
                }) ?? null;
              const target =
                dragState.dropTarget ??
                resolveDropTarget(
                  dragState.draggingBlockPos,
                  block,
                  event.clientY,
                  view,
                );

              if (!target) {
                clearDragState(view);
                return true;
              }

              const moved = moveBlock(view, dragState.draggingBlockPos, target);
              if (!moved) {
                clearDragState(view);
              }
              return true;
            },
            handleDOMEvents: {
              dragend(view) {
                const state = currentState;
                if (state.draggingBlockPos != null && state.dropTarget) {
                  moveBlock(view, state.draggingBlockPos, state.dropTarget);
                } else {
                  clearDragState(view);
                }
                return false;
              },
              dragover(view, event) {
                const dragState = currentState;
                if (dragState.draggingBlockPos == null) return false;

                event.preventDefault();
                if (event.dataTransfer) {
                  event.dataTransfer.dropEffect = "move";
                }

                const editorRect = view.dom.getBoundingClientRect();
                const block = resolveTopLevelBlockAtCoords(view, {
                  left: editorRect.left + 24,
                  top: event.clientY,
                });
                const nextTarget = resolveDropTarget(
                  dragState.draggingBlockPos,
                  block,
                  event.clientY,
                  view,
                );
                const meta = createMeta({ dropTarget: nextTarget }, dragState);
                if (!meta) return false;
                view.dispatch(
                  view.state.tr.setMeta(BLOCK_DRAG_STORAGE_KEY, meta),
                );
                return false;
              },
            },
          },
          view(view) {
            (
              view as EditorView & {
                __blockDragReadState?: () => BlockDragState;
              }
            ).__blockDragReadState = () => currentState;
            let frame = 0;

            const updateActiveBlock = (event: MouseEvent) => {
              const dragState = currentState;
              if (dragState.draggingBlockPos != null) return;

              const editorRect = view.dom.getBoundingClientRect();
              const inBounds =
                event.clientY >= editorRect.top &&
                event.clientY <= editorRect.bottom &&
                event.clientX >= editorRect.left - 40 &&
                event.clientX <= editorRect.right + 8;

              const nextPos = inBounds
                ? (resolveTopLevelBlockAtCoords(view, {
                    left: editorRect.left + 24,
                    top: event.clientY,
                  })?.pos ?? null)
                : null;
              const meta = createMeta({ activeBlockPos: nextPos }, dragState);
              if (!meta) return;
              view.dispatch(
                view.state.tr.setMeta(BLOCK_DRAG_STORAGE_KEY, meta),
              );
            };

            const handleMouseMove = (event: MouseEvent) => {
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(() => updateActiveBlock(event));
            };

            let clearFrame = 0;
            const clearActiveBlock = (e: FocusEvent) => {
              const related = e.relatedTarget as HTMLElement | null;
              if (related?.closest?.("[data-drag-handle]")) return;

              cancelAnimationFrame(clearFrame);
              clearFrame = requestAnimationFrame(() => {
                const dragState = currentState;
                if (dragState.draggingBlockPos != null) return;
                const meta = createMeta(
                  { activeBlockPos: null, dropTarget: null },
                  dragState,
                );
                if (!meta) return;
                view.dispatch(
                  view.state.tr.setMeta(BLOCK_DRAG_STORAGE_KEY, meta),
                );
              });
            };

            document.addEventListener("mousemove", handleMouseMove);
            view.dom.addEventListener(
              "blur",
              clearActiveBlock as EventListener,
              true,
            );

            return {
              destroy() {
                delete (
                  view as EditorView & {
                    __blockDragReadState?: () => BlockDragState;
                  }
                ).__blockDragReadState;
                cancelAnimationFrame(frame);
                cancelAnimationFrame(clearFrame);
                document.removeEventListener("mousemove", handleMouseMove);
                view.dom.removeEventListener(
                  "blur",
                  clearActiveBlock as EventListener,
                  true,
                );
              },
            };
          },
        }),
      ];
    },
  });
};

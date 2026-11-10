import { Extension } from "@tiptap/core";
import { DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
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

export const blockDragPluginKey = new PluginKey<BlockDragState>("blockDrag");

function isHTMLElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

function getBlockDragMeta(tr: Transaction) {
  return tr.getMeta(blockDragPluginKey) as BlockDragMeta | undefined;
}

function getTopLevelBlockNode(view: EditorView, pos: number) {
  const { doc } = view.state;
  if (pos < 0 || pos >= doc.content.size) {
    return null;
  }

  const $pos = doc.resolve(pos);
  if ($pos.depth !== 0) {
    return null;
  }

  const node = doc.nodeAt(pos);
  return node?.isBlock ? node : null;
}

function isTopLevelDraggable(view: EditorView, pos: number): TopLevelBlockInfo | null {
  const node = getTopLevelBlockNode(view, pos);
  if (!node) {
    return null;
  }

  let dom = view.nodeDOM(pos);
  if (dom instanceof Text) {
    dom = dom.parentElement;
  }
  if (!isHTMLElement(dom)) {
    return null;
  }

  return {
    pos,
    nodeSize: node.nodeSize,
    dom,
  };
}

function resolveTopLevelBlockByRect(view: EditorView, y: number): TopLevelBlockInfo | null {
  let offset = 0;
  for (let i = 0; i < view.state.doc.childCount; i++) {
    const child = view.state.doc.child(i);
    let dom = view.nodeDOM(offset);
    if (dom instanceof Text) {
      dom = dom.parentElement;
    }
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

function resolveDropTarget(
  sourcePos: number,
  target: TopLevelBlockInfo | null,
  mouseY: number,
  view: EditorView,
): BlockDragTarget | null {
  if (!target) {
    return null;
  }

  const sourceNode = getTopLevelBlockNode(view, sourcePos);
  const targetNode = getTopLevelBlockNode(view, target.pos);
  if (!sourceNode || !targetNode) {
    return null;
  }

  const rect = target.dom.getBoundingClientRect();
  const placement: BlockDragTarget["placement"] = mouseY <= rect.top + rect.height / 2 ? "before" : "after";

  if (sourcePos === target.pos) {
    return null;
  }
  if (placement === "before" && sourcePos + sourceNode.nodeSize === target.pos) {
    return null;
  }
  if (placement === "after" && target.pos + targetNode.nodeSize === sourcePos) {
    return null;
  }

  return {
    pos: target.pos,
    placement,
  };
}

function resolveDropTargetAtY(view: EditorView, sourcePos: number, clientY: number): BlockDragTarget | null {
  const editorRect = view.dom.getBoundingClientRect();
  const block = resolveTopLevelBlockAtCoords(view, {
    left: editorRect.left + 24,
    top: clientY,
  });
  return resolveDropTarget(sourcePos, block, clientY, view);
}

function createMeta(next: BlockDragMeta, current: BlockDragState): BlockDragMeta | null {
  const merged: BlockDragState = {
    activeBlockPos: next.activeBlockPos !== undefined ? next.activeBlockPos : current.activeBlockPos,
    draggingBlockPos: next.draggingBlockPos !== undefined ? next.draggingBlockPos : current.draggingBlockPos,
    dropTarget: next.dropTarget !== undefined ? next.dropTarget : current.dropTarget,
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
  const current = blockDragPluginKey.getState(view.state) ?? INITIAL_STATE;
  const meta = createMeta(
    {
      activeBlockPos: null,
      draggingBlockPos: null,
      dropTarget: null,
    },
    current,
  );
  if (!meta) {
    return;
  }
  view.dispatch(view.state.tr.setMeta(blockDragPluginKey, meta));
}

function moveBlock(view: EditorView, sourcePos: number, target: BlockDragTarget): boolean {
  const { state } = view;
  const sourceNode = state.doc.nodeAt(sourcePos);
  if (!sourceNode) {
    return false;
  }

  const targetNode = state.doc.nodeAt(target.pos);
  if (!targetNode) {
    return false;
  }

  const sourceSlice = new Slice(Fragment.from(sourceNode), 0, 0);
  let tr = state.tr.delete(sourcePos, sourcePos + sourceNode.nodeSize);
  const mappedTargetPos = tr.mapping.map(target.pos, -1);
  const mappedTargetNode = tr.doc.nodeAt(mappedTargetPos);
  if (!mappedTargetNode) {
    return false;
  }

  const insertPos = target.placement === "before" ? mappedTargetPos : mappedTargetPos + mappedTargetNode.nodeSize;

  tr = tr.insert(insertPos, sourceSlice.content);
  tr = tr.setMeta(blockDragPluginKey, {
    activeBlockPos: insertPos,
    draggingBlockPos: null,
    dropTarget: null,
  });

  view.dispatch(tr.scrollIntoView());
  return true;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockDrag: {
      startBlockDrag: (pos: number, dataTransfer?: DataTransfer | null) => ReturnType;
      clearBlockDrag: () => ReturnType;
    };
  }
}

export function getBlockDragState(editor: Editor): BlockDragState {
  return blockDragPluginKey.getState(editor.state) ?? INITIAL_STATE;
}

export const createBlockDragExtension = () => {
  return Extension.create({
    name: "blockDrag",

    addCommands() {
      return {
        startBlockDrag:
          (pos, dataTransfer) =>
          ({ editor, tr }) => {
            if (!editor.isEditable) {
              return false;
            }
            const block = isTopLevelDraggable(editor.view, pos);
            if (!block) {
              return false;
            }

            const node = tr.doc.nodeAt(pos);
            if (!node) {
              return false;
            }

            tr.setSelection(NodeSelection.create(tr.doc, pos)).setMeta(blockDragPluginKey, {
              activeBlockPos: pos,
              draggingBlockPos: pos,
              dropTarget: null,
            });

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
          ({ editor, tr }) => {
            const meta = createMeta(
              {
                activeBlockPos: null,
                draggingBlockPos: null,
                dropTarget: null,
              },
              getBlockDragState(editor),
            );
            if (meta) {
              tr.setMeta(blockDragPluginKey, meta);
            }
            return true;
          },
      };
    },

    addProseMirrorPlugins() {
      let dragoverFrame: number | null = null;
      let pendingDragover: { view: EditorView; clientY: number } | null = null;

      const cancelPendingDragover = () => {
        if (dragoverFrame !== null) {
          cancelAnimationFrame(dragoverFrame);
          dragoverFrame = null;
        }
        pendingDragover = null;
      };

      const flushPendingDragover = () => {
        dragoverFrame = null;
        const pending = pendingDragover;
        pendingDragover = null;
        if (!pending) {
          return;
        }

        const dragState = blockDragPluginKey.getState(pending.view.state) ?? INITIAL_STATE;
        if (dragState.draggingBlockPos === null) {
          return;
        }

        const nextTarget = resolveDropTargetAtY(pending.view, dragState.draggingBlockPos, pending.clientY);
        const meta = createMeta({ dropTarget: nextTarget }, dragState);
        if (meta) {
          pending.view.dispatch(pending.view.state.tr.setMeta(blockDragPluginKey, meta));
        }
      };

      const scheduleDragover = (view: EditorView, clientY: number) => {
        pendingDragover = { view, clientY };
        if (dragoverFrame === null) {
          dragoverFrame = requestAnimationFrame(flushPendingDragover);
        }
      };

      return [
        new Plugin<BlockDragState>({
          key: blockDragPluginKey,
          state: {
            init: () => INITIAL_STATE,
            apply(tr, pluginState) {
              const meta = getBlockDragMeta(tr);
              if (!meta) {
                if (!tr.docChanged) {
                  return pluginState;
                }
                const mapPosition = (pos: number | null) => {
                  if (pos === null) {
                    return null;
                  }
                  const mapped = tr.mapping.mapResult(pos);
                  return mapped.deleted ? null : mapped.pos;
                };
                const mappedDropPos = mapPosition(pluginState.dropTarget?.pos ?? null);
                const mappedState: BlockDragState = {
                  activeBlockPos: mapPosition(pluginState.activeBlockPos),
                  draggingBlockPos: mapPosition(pluginState.draggingBlockPos),
                  dropTarget:
                    mappedDropPos === null || !pluginState.dropTarget
                      ? null
                      : { ...pluginState.dropTarget, pos: mappedDropPos },
                };
                return mappedState;
              }

              const nextState = {
                activeBlockPos: meta.activeBlockPos !== undefined ? meta.activeBlockPos : pluginState.activeBlockPos,
                draggingBlockPos:
                  meta.draggingBlockPos !== undefined ? meta.draggingBlockPos : pluginState.draggingBlockPos,
                dropTarget: meta.dropTarget !== undefined ? meta.dropTarget : pluginState.dropTarget,
              };
              return nextState;
            },
          },
          props: {
            handleDrop(view, event) {
              const dragState = blockDragPluginKey.getState(view.state) ?? INITIAL_STATE;
              if (dragState.draggingBlockPos === null) {
                return false;
              }

              event.preventDefault();
              cancelPendingDragover();
              const target = resolveDropTargetAtY(view, dragState.draggingBlockPos, event.clientY);

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
                cancelPendingDragover();
                clearDragState(view);
                return false;
              },
              dragover(view, event) {
                const dragState = blockDragPluginKey.getState(view.state) ?? INITIAL_STATE;
                if (dragState.draggingBlockPos === null) {
                  return false;
                }

                event.preventDefault();
                if (event.dataTransfer) {
                  event.dataTransfer.dropEffect = "move";
                }

                scheduleDragover(view, event.clientY);
                return false;
              },
            },
          },
          view(view) {
            let frame = 0;
            const interactionRoot = view.dom.closest(".markdown-editor") ?? view.dom.parentElement ?? view.dom;

            const updateActiveBlock = (event: MouseEvent) => {
              if (!view.editable) {
                return;
              }
              if ((event.target as Element | null)?.closest?.("[data-drag-handle]")) {
                return;
              }
              const dragState = blockDragPluginKey.getState(view.state) ?? INITIAL_STATE;
              if (dragState.draggingBlockPos !== null) {
                return;
              }

              const editorRect = view.dom.getBoundingClientRect();
              const inBounds =
                event.clientY >= editorRect.top &&
                event.clientY <= editorRect.bottom &&
                event.clientX >= editorRect.left - 80 &&
                event.clientX <= editorRect.right + 8;

              const nextPos = inBounds
                ? (resolveTopLevelBlockAtCoords(view, {
                    left: editorRect.left + 24,
                    top: event.clientY,
                  })?.pos ?? null)
                : null;
              const meta = createMeta({ activeBlockPos: nextPos }, dragState);
              if (!meta) {
                return;
              }
              view.dispatch(view.state.tr.setMeta(blockDragPluginKey, meta));
            };

            const handleMouseMove = (event: MouseEvent) => {
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(() => updateActiveBlock(event));
            };

            let clearFrame = 0;
            const clearActiveBlock = (e: FocusEvent) => {
              const related = e.relatedTarget as HTMLElement | null;
              if (related?.closest?.("[data-drag-handle]")) {
                return;
              }

              cancelAnimationFrame(clearFrame);
              clearFrame = requestAnimationFrame(() => {
                const dragState = blockDragPluginKey.getState(view.state) ?? INITIAL_STATE;
                if (dragState.draggingBlockPos !== null) {
                  return;
                }
                const meta = createMeta({ activeBlockPos: null, dropTarget: null }, dragState);
                if (!meta) {
                  return;
                }
                view.dispatch(view.state.tr.setMeta(blockDragPluginKey, meta));
              });
            };

            interactionRoot.addEventListener("mousemove", handleMouseMove as EventListener);
            view.dom.addEventListener("blur", clearActiveBlock as EventListener, true);

            return {
              destroy() {
                cancelPendingDragover();
                cancelAnimationFrame(frame);
                cancelAnimationFrame(clearFrame);
                interactionRoot.removeEventListener("mousemove", handleMouseMove as EventListener);
                view.dom.removeEventListener("blur", clearActiveBlock as EventListener, true);
              },
            };
          },
        }),
      ];
    },
  });
};

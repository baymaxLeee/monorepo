import { cn } from "@repo/shared";
import type { Editor } from "@tiptap/react";
import { GripVertical, Table as TableIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getBlockDragState } from "../../extensions/BlockDrag";
import { selectTableAt } from "../../extensions/Table/utils";
import { getMountedEditorDom } from "../../utils";

interface DragHandlerProps {
  editor: Editor;
}

const editorRootClassName = "markdown-editor";

const HANDLE_BASE_CLS =
  "absolute z-20 flex size-5 cursor-grab select-none items-center justify-center rounded text-foreground/80 transition-[background-color,color,opacity] duration-150 hover:bg-accent hover:text-foreground active:bg-accent active:text-foreground";

const HANDLE_DRAGGING_CLS = "cursor-grabbing bg-accent text-foreground";

const TABLE_HANDLE_CLS =
  "absolute z-20 flex h-7 items-stretch overflow-hidden rounded-lg border bg-background/95 text-muted-foreground shadow-sm backdrop-blur transition-[background-color,border-color,box-shadow] duration-150 hover:border-foreground/20 hover:shadow-md";

const TABLE_ACTION_CLS =
  "flex items-center justify-center transition-[background-color,color] duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const TABLE_HANDLE_WIDTH = 56;
const TABLE_HANDLE_HEIGHT = 28;
const TABLE_HANDLE_GAP = 4;

const INDICATOR_CLS = "pointer-events-none absolute z-[19] h-0.5 rounded-full bg-primary";

function isHTMLElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

function isFloatingMenuActive(editor: Editor, blockPos: number): boolean {
  const { selection } = editor.state;
  const { empty, $anchor } = selection;

  if (!empty || !$anchor.parent.isTextblock || $anchor.parent.type.spec.code || $anchor.parent.textContent) {
    return false;
  }

  for (let depth = $anchor.depth; depth > 0; depth -= 1) {
    if ($anchor.node(depth - 1).type.name === "doc") {
      return $anchor.before(depth) === blockPos;
    }
  }

  return false;
}

type DragViewState = ReturnType<typeof getBlockDragState> & {
  floatingMenuActive: boolean;
};

interface HandlePosition {
  top: number;
  left: number;
}

interface LinePosition extends HandlePosition {
  width: number;
}

const HIDDEN_HANDLE_POSITION: HandlePosition = { top: 0, left: 0 };

function readDragViewState(editor: Editor): DragViewState {
  const dragState = getBlockDragState(editor);
  return {
    ...dragState,
    floatingMenuActive: dragState.activeBlockPos !== null && isFloatingMenuActive(editor, dragState.activeBlockPos),
  };
}

function isSameDragViewState(left: DragViewState, right: DragViewState): boolean {
  return (
    left.activeBlockPos === right.activeBlockPos &&
    left.draggingBlockPos === right.draggingBlockPos &&
    left.dropTarget?.pos === right.dropTarget?.pos &&
    left.dropTarget?.placement === right.dropTarget?.placement &&
    left.floatingMenuActive === right.floatingMenuActive
  );
}

function isSameHandlePosition(left: HandlePosition, right: HandlePosition): boolean {
  return left.top === right.top && left.left === right.left;
}

function isSameLinePosition(left: LinePosition | null, right: LinePosition | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return isSameHandlePosition(left, right) && left.width === right.width;
}

export const DragHandler: React.FC<DragHandlerProps> = ({ editor }) => {
  const layoutFrameRef = useRef<number | null>(null);
  const [dragViewState, setDragViewState] = useState(() => readDragViewState(editor));
  const dragViewStateRef = useRef(dragViewState);
  const [portalContainer, setPortalContainer] = useState<HTMLElement>(() => document.body);
  const [position, setPosition] = useState<HandlePosition>(HIDDEN_HANDLE_POSITION);
  const [linePosition, setLinePosition] = useState<LinePosition | null>(null);

  const syncLayout = useCallback(() => {
    const container = portalContainer;
    const view = editor.view;
    const editorDom = getMountedEditorDom(editor);
    if (!container || !editorDom) {
      return;
    }

    const dragState = getBlockDragState(editor);
    const activePos = dragState.draggingBlockPos ?? dragState.activeBlockPos ?? null;
    let containerRect: DOMRect | null = null;
    const getContainerRect = () => {
      containerRect ??= container.getBoundingClientRect();
      return containerRect;
    };

    if (activePos === null || isFloatingMenuActive(editor, activePos)) {
      setPosition((previous) =>
        isSameHandlePosition(previous, HIDDEN_HANDLE_POSITION) ? previous : HIDDEN_HANDLE_POSITION,
      );
    } else {
      let dom = view.nodeDOM(activePos);
      if (dom instanceof Text) {
        dom = dom.parentElement;
      }
      if (!isHTMLElement(dom)) {
        setPosition((previous) =>
          isSameHandlePosition(previous, HIDDEN_HANDLE_POSITION) ? previous : HIDDEN_HANDLE_POSITION,
        );
      } else {
        const measuredContainerRect = getContainerRect();
        const editorRect = editorDom.getBoundingClientRect();
        const blockRect = dom.getBoundingClientRect();
        const activeNode = editor.state.doc.nodeAt(activePos);
        const tableDom = activeNode?.type.spec.tableRole === "table" ? dom.querySelector("table") : null;
        const nextPosition = tableDom
          ? (() => {
              const tableRect = tableDom.getBoundingClientRect();
              return {
                top: tableRect.top - measuredContainerRect.top + container.scrollTop - TABLE_HANDLE_HEIGHT,
                left:
                  tableRect.left -
                  measuredContainerRect.left +
                  container.scrollLeft -
                  TABLE_HANDLE_WIDTH -
                  TABLE_HANDLE_GAP,
              };
            })()
          : {
              top: blockRect.top - measuredContainerRect.top + container.scrollTop + 2,
              left: editorRect.left - measuredContainerRect.left + container.scrollLeft - 24,
            };
        setPosition((previous) => (isSameHandlePosition(previous, nextPosition) ? previous : nextPosition));
      }
    }

    if (dragState.draggingBlockPos === null || !dragState.dropTarget) {
      setLinePosition((previous) => (previous === null ? previous : null));
      return;
    }

    let dom = view.nodeDOM(dragState.dropTarget.pos);
    if (dom instanceof Text) {
      dom = dom.parentElement;
    }
    if (!isHTMLElement(dom)) {
      setLinePosition((previous) => (previous === null ? previous : null));
      return;
    }

    const measuredContainerRect = getContainerRect();
    const blockRect = dom.getBoundingClientRect();
    const top =
      (dragState.dropTarget.placement === "before" ? blockRect.top : blockRect.bottom) -
      measuredContainerRect.top +
      container.scrollTop;

    const nextLinePosition = {
      top,
      left: blockRect.left - measuredContainerRect.left + container.scrollLeft,
      width: blockRect.width,
    };
    setLinePosition((previous) => (isSameLinePosition(previous, nextLinePosition) ? previous : nextLinePosition));
  }, [editor, portalContainer]);

  const scheduleLayoutSync = useCallback(() => {
    if (layoutFrameRef.current !== null) {
      return;
    }
    layoutFrameRef.current = requestAnimationFrame(() => {
      layoutFrameRef.current = null;
      syncLayout();
    });
  }, [syncLayout]);

  const clearDraggingState = useCallback(() => {
    setLinePosition(null);
    if (getBlockDragState(editor).draggingBlockPos === null) {
      return;
    }
    editor.commands.clearBlockDrag();
  }, [editor]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const editorDom = getMountedEditorDom(editor);
      if (!editorDom) {
        return;
      }

      const wrapper = editorDom.closest<HTMLElement>(`.${editorRootClassName}`) || editorDom.parentElement;
      if (wrapper) {
        setPortalContainer((current) => (current === wrapper ? current : wrapper));
      }
      scheduleLayoutSync();
    });

    return () => cancelAnimationFrame(frame);
  }, [editor, scheduleLayoutSync]);

  const isDragging = dragViewState.draggingBlockPos !== null;

  useEffect(() => {
    if (isDragging) {
      portalContainer.setAttribute("data-block-dragging", "true");
    } else {
      portalContainer.removeAttribute("data-block-dragging");
    }

    return () => {
      portalContainer.removeAttribute("data-block-dragging");
    };
  }, [isDragging, portalContainer]);

  useEffect(() => {
    const update = (event?: { transaction: { docChanged: boolean } }) => {
      const nextDragViewState = readDragViewState(editor);
      const stateChanged = !isSameDragViewState(dragViewStateRef.current, nextDragViewState);
      if (stateChanged) {
        dragViewStateRef.current = nextDragViewState;
        setDragViewState(nextDragViewState);
      }
      if (
        !event ||
        stateChanged ||
        (event.transaction.docChanged &&
          (nextDragViewState.activeBlockPos !== null || nextDragViewState.draggingBlockPos !== null))
      ) {
        scheduleLayoutSync();
      }
    };

    update();
    editor.on("transaction", update);

    return () => {
      editor.off("transaction", update);
      if (layoutFrameRef.current !== null) {
        cancelAnimationFrame(layoutFrameRef.current);
        layoutFrameRef.current = null;
      }
    };
  }, [editor, scheduleLayoutSync]);

  useEffect(() => {
    const handleDrop = () => {
      setLinePosition(null);
    };
    const handleDragEnd = () => {
      setLinePosition(null);
      clearDraggingState();
    };

    document.addEventListener("drop", handleDrop, true);
    document.addEventListener("dragend", handleDragEnd, true);

    return () => {
      document.removeEventListener("drop", handleDrop, true);
      document.removeEventListener("dragend", handleDragEnd, true);
    };
  }, [clearDraggingState]);

  useEffect(() => {
    const scrollContainer = getMountedEditorDom(editor)?.parentElement;
    if (!scrollContainer) {
      return;
    }

    const onScroll = () => {
      scheduleLayoutSync();
    };

    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", onScroll);

    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [editor, scheduleLayoutSync]);

  const onDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const activePos = getBlockDragState(editor).activeBlockPos;
      if (activePos === null) {
        event.preventDefault();
        return;
      }

      editor.commands.startBlockDrag(activePos, event.dataTransfer);
    },
    [editor],
  );

  const visible = dragViewState.activeBlockPos !== null && !dragViewState.floatingMenuActive;
  const activeBlockPos = dragViewState.draggingBlockPos ?? dragViewState.activeBlockPos;
  const activeBlock = activeBlockPos === null ? null : editor.state.doc.nodeAt(activeBlockPos);
  const isTableBlock = activeBlock?.type.spec.tableRole === "table";

  const selectActiveTable = useCallback(() => {
    const activePos = getBlockDragState(editor).activeBlockPos;
    if (activePos === null || editor.state.doc.nodeAt(activePos)?.type.spec.tableRole !== "table") {
      return;
    }
    editor.view.dispatch(selectTableAt(activePos)(editor.state.tr));
    editor.view.focus();
  }, [editor]);

  return createPortal(
    <>
      {visible && isTableBlock ? (
        <div
          className={cn(TABLE_HANDLE_CLS, isDragging && "border-primary shadow-md")}
          style={{ top: position.top, left: position.left }}
          data-drag-handle=""
        >
          <button
            type="button"
            aria-label="选择整张表格"
            title="选择整张表格"
            className={cn(TABLE_ACTION_CLS, "w-8 border-r text-primary")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={selectActiveTable}
          >
            <TableIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="拖拽表格"
            title="拖拽表格"
            className={cn(TABLE_ACTION_CLS, "w-6 cursor-grab active:cursor-grabbing")}
            draggable
            onDragStart={onDragStart}
          >
            <GripVertical className="size-4" />
          </button>
        </div>
      ) : visible ? (
        <div
          className={cn(HANDLE_BASE_CLS, isDragging && HANDLE_DRAGGING_CLS)}
          style={{ top: position.top, left: position.left }}
          data-drag-handle=""
          tabIndex={-1}
          draggable
          onDragStart={onDragStart}
        >
          <GripVertical className="size-[1.5em]" />
        </div>
      ) : null}
      {isDragging && linePosition && (
        <div
          className={INDICATOR_CLS}
          style={{
            top: linePosition.top,
            left: linePosition.left,
            width: linePosition.width,
          }}
        />
      )}
    </>,
    portalContainer,
  );
};

export const DragHandle = DragHandler;

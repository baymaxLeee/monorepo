import type { Editor } from "@tiptap/react";
import { GripVertical } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "shared";
import { getBlockDragState } from "../../extensions/BlockDrag";
import { getMountedEditorDom } from "../../utils";

interface DragHandlerProps {
  editor: Editor;
}

const editorRootClassName = "markdown-editor";

const HANDLE_BASE_CLS =
  "absolute z-20 flex size-5 cursor-grab select-none items-center justify-center rounded text-foreground/80 transition-[background-color,color,opacity] duration-150 hover:bg-accent hover:text-foreground active:bg-accent active:text-foreground";

const HANDLE_DRAGGING_CLS = "cursor-grabbing bg-accent text-foreground";

const INDICATOR_CLS =
  "pointer-events-none absolute z-[19] h-0.5 rounded-full bg-primary";

function isHTMLElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

function isFloatingMenuActive(editor: Editor, blockPos: number): boolean {
  const { selection } = editor.state;
  const { empty, $anchor } = selection;

  if (
    !empty ||
    !$anchor.parent.isTextblock ||
    $anchor.parent.type.spec.code ||
    $anchor.parent.textContent
  ) {
    return false;
  }

  for (let depth = $anchor.depth; depth > 0; depth -= 1) {
    if ($anchor.node(depth - 1).type.name === "doc") {
      return $anchor.before(depth) === blockPos;
    }
  }

  return false;
}

export const DragHandler: React.FC<DragHandlerProps> = ({ editor }) => {
  const portalContainerRef = useRef<HTMLElement>(document.body);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [linePosition, setLinePosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [, setVersion] = useState(0);

  const syncPosition = useCallback(() => {
    const container = portalContainerRef.current;
    const view = editor.view;
    const editorDom = getMountedEditorDom(editor);
    if (!container || !editorDom) return;

    const dragState = getBlockDragState(editor);
    const activePos =
      dragState.draggingBlockPos ?? dragState.activeBlockPos ?? null;

    if (activePos == null || isFloatingMenuActive(editor, activePos)) {
      setPosition((prev) =>
        prev.top === 0 && prev.left === 0 ? prev : { top: 0, left: 0 },
      );
      return;
    }

    let dom = view.nodeDOM(activePos);
    if (dom instanceof Text) dom = dom.parentElement;
    if (!isHTMLElement(dom)) return;

    const containerRect = container.getBoundingClientRect();
    const editorRect = editorDom.getBoundingClientRect();
    const blockRect = dom.getBoundingClientRect();

    setPosition({
      top: blockRect.top - containerRect.top + container.scrollTop + 2,
      left: editorRect.left - containerRect.left + container.scrollLeft - 24,
    });
  }, [editor]);

  const syncDropIndicator = useCallback(() => {
    const container = portalContainerRef.current;
    const view = editor.view;
    if (!container || !getMountedEditorDom(editor)) return;

    const dragState = getBlockDragState(editor);
    if (dragState.draggingBlockPos == null || !dragState.dropTarget) {
      setLinePosition(null);
      return;
    }

    let dom = view.nodeDOM(dragState.dropTarget.pos);
    if (dom instanceof Text) dom = dom.parentElement;
    if (!isHTMLElement(dom)) {
      setLinePosition(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const blockRect = dom.getBoundingClientRect();
    const top =
      (dragState.dropTarget.placement === "before"
        ? blockRect.top
        : blockRect.bottom) -
      containerRect.top +
      container.scrollTop;

    setLinePosition({
      top,
      left: blockRect.left - containerRect.left + container.scrollLeft,
      width: blockRect.width,
    });
  }, [editor]);

  const clearDraggingState = useCallback(() => {
    setLinePosition(null);
    if (getBlockDragState(editor).draggingBlockPos == null) {
      return;
    }
    editor.commands.clearBlockDrag();
  }, [editor]);

  useEffect(() => {
    const editorDom = getMountedEditorDom(editor);
    if (!editorDom) return;

    const wrapper =
      editorDom.closest<HTMLElement>(`.${editorRootClassName}`) ||
      editorDom.parentElement;

    if (wrapper) {
      portalContainerRef.current = wrapper;
    }
  }, [editor]);

  useEffect(() => {
    const wrapper = portalContainerRef.current;
    if (!wrapper) return;

    const dragState = getBlockDragState(editor);
    if (dragState.draggingBlockPos != null) {
      wrapper.setAttribute("data-block-dragging", "true");
    } else {
      wrapper.removeAttribute("data-block-dragging");
    }

    return () => {
      wrapper.removeAttribute("data-block-dragging");
    };
  }, [editor, position, linePosition]);

  useEffect(() => {
    const update = () => {
      setVersion((version) => version + 1);
      syncPosition();
      syncDropIndicator();
    };

    update();
    editor.on("transaction", update);

    return () => {
      editor.off("transaction", update);
    };
  }, [editor, syncDropIndicator, syncPosition]);

  useEffect(() => {
    const handleDrop = () => {
      setLinePosition(null);
    };
    const handleDragEnd = () => {
      setLinePosition(null);
      const dragState = getBlockDragState(editor);
      if (dragState.draggingBlockPos != null && dragState.dropTarget) {
        editor.commands.finishBlockDrag();
      } else {
        clearDraggingState();
      }
    };

    document.addEventListener("drop", handleDrop, true);
    document.addEventListener("dragend", handleDragEnd, true);

    return () => {
      document.removeEventListener("drop", handleDrop, true);
      document.removeEventListener("dragend", handleDragEnd, true);
    };
  }, [clearDraggingState, editor]);

  useEffect(() => {
    const scrollContainer = getMountedEditorDom(editor)?.parentElement;
    if (!scrollContainer) return;

    const onScroll = () => {
      syncPosition();
      syncDropIndicator();
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
  }, [editor, syncDropIndicator, syncPosition]);

  const onDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const activePos = getBlockDragState(editor).activeBlockPos;
      if (activePos == null) {
        event.preventDefault();
        return;
      }

      editor.commands.startBlockDrag(activePos, event.dataTransfer);
    },
    [editor],
  );

  const dragState = getBlockDragState(editor);
  const visible =
    dragState.activeBlockPos != null &&
    !isFloatingMenuActive(editor, dragState.activeBlockPos);

  return createPortal(
    <>
      {visible && (
        <div
          className={cn(
            HANDLE_BASE_CLS,
            dragState.draggingBlockPos != null && HANDLE_DRAGGING_CLS,
          )}
          style={{ top: position.top, left: position.left }}
          data-drag-handle=""
          tabIndex={-1}
          draggable
          onDragStart={onDragStart}
        >
          <GripVertical className="size-[1.5em]" />
        </div>
      )}
      {dragState.draggingBlockPos != null && linePosition && (
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
    portalContainerRef.current,
  );
};

export const DragHandle = DragHandler;

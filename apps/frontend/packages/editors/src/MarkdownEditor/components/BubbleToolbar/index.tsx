import { cn } from "@repo/shared";
import { isNodeSelection } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { isCellSelection } from "../../extensions/Table/utils";
import { getMountedEditorDom } from "../../utils";
import { AIPolishPanel } from "../AIPolishPanel";
import { Toolbar } from "../Toolbar";

interface IProps {
  editor: Editor;
  appendTo?: HTMLElement | (() => HTMLElement);
  zIndex?: number;
  aiOnly?: boolean;
}

/** BubbleMenu 容器的稳定 hook class（无样式职责，用于 polish panel 定位查询） */
const BUBBLE_TOOLBAR_HOOK_CLASS = "markdown-editor-bubble-toolbar";
/** 浮起气泡工具栏容器（高保真还原自原 BubbleToolbar/index.less） */
const FLOATING_PANEL_CLS = `${BUBBLE_TOOLBAR_HOOK_CLASS} relative rounded-md border bg-background text-sm text-foreground shadow-lg`;
/** 用于 closest 查找编辑器根容器的稳定 hook */
const EDITOR_ROOT_CLASS = "markdown-editor";
const OVERLAY_CONTENT_SELECTOR = '[data-slot="sheet-content"], [data-slot="dialog-content"]';
const BUBBLE_MENU_PLUGIN_KEY = "markdownEditorBubbleToolbar";

const isValidSelection = (editor: Editor) => {
  const { selection } = editor.state;
  if (selection.empty) {
    return false;
  }
  if (!editor.isFocused) {
    return false;
  }
  if (isNodeSelection(selection)) {
    return false;
  }
  if (isCellSelection(selection)) {
    return false;
  }
  return true;
};

export const BubbleToolbar: React.FC<IProps> = (props) => {
  const { editor, appendTo, zIndex, aiOnly = false } = props;

  const [polishVisible, setPolishVisible] = useState(false);
  const [showCentered, setShowCentered] = useState(false);
  const bubbleToolbarRef = useRef<HTMLDivElement>(null);
  const isRightClickRef = useRef(false);
  const dragRef = useRef({ selecting: false, scrolled: false });

  const getPortalContainer = useCallback(() => {
    if (typeof appendTo === "function") return appendTo();
    if (appendTo) return appendTo;
    const dom = getMountedEditorDom(editor);
    const overlayContent = dom?.closest(OVERLAY_CONTENT_SELECTOR) as HTMLElement | null;
    return overlayContent ?? document.body;
  }, [appendTo, editor]);

  useEffect(() => {
    const dom = getMountedEditorDom(editor);
    if (!dom) {
      return;
    }

    const onMouseDown = (e: MouseEvent) => {
      isRightClickRef.current = e.button === 2;
      if (e.button === 0) {
        dragRef.current = { selecting: true, scrolled: false };
        setShowCentered(false);
      }
    };

    const onMouseUp = () => {
      const { selecting, scrolled } = dragRef.current;
      if (selecting && scrolled && isValidSelection(editor)) {
        setShowCentered(true);
      }
      dragRef.current.selecting = false;
    };

    const onScroll = () => {
      if (dragRef.current.selecting) {
        dragRef.current.scrolled = true;
      }
    };

    dom.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      dom.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [editor]);

  useEffect(() => {
    const handler = () => {
      if (editor.state.selection.empty) {
        setShowCentered(false);
      }
    };
    editor.on("selectionUpdate", handler);
    return () => {
      editor.off("selectionUpdate", handler);
    };
  }, [editor]);

  const shouldShow = useCallback(
    ({ editor }: { editor: Editor }) => {
      if (isRightClickRef.current) {
        return false;
      }
      if (polishVisible) {
        return !editor.state.selection.empty;
      }
      if (aiOnly) {
        const { from, to, empty } = editor.state.selection;
        return !empty && editor.state.doc.textBetween(from, to, " ").trim().length > 0;
      }
      return isValidSelection(editor);
    },
    [aiOnly, polishVisible],
  );

  const getReferencedVirtualElement = useCallback(() => {
    if (!showCentered) {
      return null;
    }
    const wrapper = getMountedEditorDom(editor)?.closest(`.${EDITOR_ROOT_CLASS}`) as HTMLElement | null;
    if (!wrapper) {
      return null;
    }
    const rect = wrapper.getBoundingClientRect();
    const centerRect = new DOMRect(rect.left + rect.width / 2, rect.top + rect.height / 2, 0, 0);
    return {
      getBoundingClientRect: () => centerRect,
    };
  }, [editor, showCentered]);

  const handleOpenPolish = useCallback(() => {
    if (editor.state.selection.empty) {
      return;
    }
    setPolishVisible(true);
  }, [editor]);

  const handleClosePolish = useCallback(() => {
    setPolishVisible(false);
    editor.chain().focus().setTextSelection(editor.state.selection.to).run();
  }, [editor]);

  useEffect(() => {
    if (!polishVisible) {
      return;
    }

    const editorWrapper = getMountedEditorDom(editor)?.closest(`.${EDITOR_ROOT_CLASS}`) as HTMLElement | null;
    if (!editorWrapper) {
      return;
    }

    const onMouseDown = () => handleClosePolish();
    editorWrapper.addEventListener("mousedown", onMouseDown);
    return () => editorWrapper.removeEventListener("mousedown", onMouseDown);
  }, [polishVisible, editor, handleClosePolish]);

  useEffect(() => {
    if (!polishVisible) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClosePolish();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [polishVisible, handleClosePolish]);

  const updateBubbleMenuPosition = useCallback(() => {
    if (!editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta(BUBBLE_MENU_PLUGIN_KEY, "updatePosition"));
    }
  }, [editor]);

  useEffect(() => {
    const element = bubbleToolbarRef.current;
    if (!element) {
      return;
    }

    const frame = requestAnimationFrame(updateBubbleMenuPosition);
    if (!polishVisible) {
      return () => cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(updateBubbleMenuPosition);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [polishVisible, showCentered, updateBubbleMenuPosition]);

  const portalContainer = getPortalContainer();

  return (
    <BubbleMenu
      ref={bubbleToolbarRef}
      pluginKey={BUBBLE_MENU_PLUGIN_KEY}
      className={cn(FLOATING_PANEL_CLS, showCentered && "translate-y-1/2")}
      editor={editor}
      shouldShow={shouldShow}
      appendTo={appendTo ?? portalContainer}
      getReferencedVirtualElement={getReferencedVirtualElement}
      style={zIndex === undefined ? undefined : { zIndex }}
      options={{
        placement: "top",
        offset: showCentered ? false : 8,
        flip: showCentered ? false : { padding: 8 },
        shift: showCentered ? false : { padding: 8 },
        hide: false,
      }}
    >
      {polishVisible ? (
        <AIPolishPanel editor={editor} onClose={handleClosePolish} />
      ) : (
        <Toolbar editor={editor} aiOnly={aiOnly} onOpenPolish={handleOpenPolish} />
      )}
    </BubbleMenu>
  );
};

import { isNodeSelection } from "@tiptap/core";
import { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { slotClassNameFactory } from "../../../compat/className";
import { AiPolishStatus } from "../../constants";
import { isCellSelection } from "../../extensions/Table/utils";
import { getMountedEditorDom } from "../../utils";
import { AIPolishContent, Toolbar } from "../Toolbar";

interface IProps {
  editor: Editor;
  aiEnable?: boolean;
  commentEnable?: boolean;
}

interface PolishPosition {
  top: number;
  left: number;
}

const POSITION_EPSILON = 0.5;

const cssPrefix = slotClassNameFactory("markdown-editor-bubble-toolbar");
const editorRootClassName = slotClassNameFactory("markdown-editor")``;

const isValidSelection = (editor: Editor) => {
  const { selection } = editor.state;
  if (selection.empty) return false;
  if (!editor.isFocused) return false;
  if (isNodeSelection(selection)) return false;
  if (isCellSelection(selection)) return false;
  return true;
};

export const BubbleToolbar: React.FC<IProps> = (props) => {
  const { editor, aiEnable } = props;

  const [polishVisible, setPolishVisible] = useState(false);
  const [polishPos, setPolishPos] = useState<PolishPosition | null>(null);
  const [showCentered, setShowCentered] = useState(false);
  const polishRef = useRef<HTMLDivElement>(null);
  const polishStatusRef = useRef<AiPolishStatus>(AiPolishStatus.Pending);
  const isRightClickRef = useRef(false);
  const showCenteredRef = useRef(false);
  const dragRef = useRef({ selecting: false, scrolled: false });
  const anchorRef = useRef<{
    top: number;
    bottom: number;
    centerX: number;
  } | null>(null);
  const polishCenteredRef = useRef(false);
  const lastPolishPosRef = useRef<PolishPosition | null>(null);
  const skipNextResizeAdjustRef = useRef(false);

  useEffect(() => {
    const dom = getMountedEditorDom(editor);
    if (!dom) return;

    const onMouseDown = (e: MouseEvent) => {
      isRightClickRef.current = e.button === 2;
      if (e.button === 0) {
        dragRef.current = { selecting: true, scrolled: false };
        showCenteredRef.current = false;
        setShowCentered(false);
      }
    };

    const onMouseUp = () => {
      const { selecting, scrolled } = dragRef.current;
      if (selecting && scrolled && isValidSelection(editor)) {
        showCenteredRef.current = true;
        setShowCentered(true);
      }
      dragRef.current.selecting = false;
    };

    const onScroll = () => {
      if (dragRef.current.selecting) dragRef.current.scrolled = true;
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
      if (editor.state.selection.empty && showCenteredRef.current) {
        showCenteredRef.current = false;
        setShowCentered(false);
      }
    };
    editor.on("selectionUpdate", handler);
    return () => {
      editor.off("selectionUpdate", handler);
    };
  }, [editor]);

  const shouldShow = useCallback(({ editor }: { editor: Editor }) => {
    if (showCenteredRef.current) return false;
    if (isRightClickRef.current) return false;
    return isValidSelection(editor);
  }, []);

  const getEditorCenterPos = (): PolishPosition | null => {
    const wrapper = getMountedEditorDom(editor)?.closest(
      `.${editorRootClassName}`,
    ) as HTMLElement | null;
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    return {
      top: rect.top + rect.height / 2,
      left: rect.left + rect.width / 2,
    };
  };

  const getCurrentToolbarPos = (): PolishPosition | null => {
    const toolbar = document.querySelector(
      `.${cssPrefix`container`}`,
    ) as HTMLElement | null;
    if (!toolbar) return null;
    const rect = toolbar.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
    };
  };

  const handleOpenPolish = useCallback(() => {
    const { selection } = editor.state;
    if (selection.empty) return;

    polishCenteredRef.current = showCenteredRef.current;
    skipNextResizeAdjustRef.current = true;
    if (showCenteredRef.current) {
      const nextPos = getEditorCenterPos();
      lastPolishPosRef.current = nextPos;
      setPolishPos(nextPos);
    } else {
      const toolbarPos = getCurrentToolbarPos();
      const fromCoords = editor.view.coordsAtPos(selection.from);
      const toCoords = editor.view.coordsAtPos(selection.to);
      anchorRef.current = {
        top: Math.min(fromCoords.top, toCoords.top),
        bottom: Math.max(fromCoords.bottom, toCoords.bottom),
        centerX: (fromCoords.left + toCoords.left) / 2,
      };
      const nextPos = toolbarPos ?? {
        top: toCoords.bottom + 8,
        left: anchorRef.current.centerX,
      };
      lastPolishPosRef.current = nextPos;
      setPolishPos(nextPos);
    }
    setPolishVisible(true);
  }, [editor]);

  const handleClosePolish = useCallback(() => {
    if (polishStatusRef.current !== AiPolishStatus.Pending) return;
    setPolishVisible(false);
    setPolishPos(null);
    lastPolishPosRef.current = null;
    skipNextResizeAdjustRef.current = false;
    editor.chain().focus().setTextSelection(editor.state.selection.to).run();
  }, [editor]);

  useEffect(() => {
    if (!polishVisible) return;

    const editorWrapper = getMountedEditorDom(editor)?.closest(
      `.${editorRootClassName}`,
    ) as HTMLElement | null;
    if (!editorWrapper) return;

    const onMouseDown = () => handleClosePolish();
    editorWrapper.addEventListener("mousedown", onMouseDown);
    return () => editorWrapper.removeEventListener("mousedown", onMouseDown);
  }, [polishVisible, editor, handleClosePolish]);

  useEffect(() => {
    if (!polishVisible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClosePolish();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [polishVisible, handleClosePolish]);

  const adjustPolishPosition = useCallback(() => {
    if (!polishRef.current || polishCenteredRef.current) return;
    const el = polishRef.current;
    const { width, height } = el.getBoundingClientRect();
    const anchor = anchorRef.current;

    const wrapper = getMountedEditorDom(editor)?.closest(
      `.${editorRootClassName}`,
    ) as HTMLElement | null;
    const bounds = wrapper?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
      left: 0,
      right: window.innerWidth,
    };
    const pad = 8;

    const baseLeft = anchor
      ? anchor.centerX
      : (lastPolishPosRef.current?.left ?? 0);
    let left = baseLeft - width / 2;
    left = Math.max(
      bounds.left + pad,
      Math.min(left, bounds.right - width - pad),
    );

    const baseTop = anchor
      ? anchor.bottom + 8
      : (lastPolishPosRef.current?.top ?? 0);
    let top = baseTop;
    if (top + height > bounds.bottom - pad && anchor) {
      top = anchor.top - height - 8;
    }
    top = Math.max(
      bounds.top + pad,
      Math.min(top, bounds.bottom - height - pad),
    );

    const prevPos = lastPolishPosRef.current;
    const positionChanged =
      !prevPos ||
      Math.abs(top - prevPos.top) > POSITION_EPSILON ||
      Math.abs(left - prevPos.left) > POSITION_EPSILON;

    if (positionChanged) {
      const nextPos = { top, left };
      lastPolishPosRef.current = nextPos;
      setPolishPos(nextPos);
    }
  }, [editor]);

  useEffect(() => {
    if (!polishVisible || !polishRef.current || polishCenteredRef.current)
      return;
    const el = polishRef.current;
    const ro = new ResizeObserver(() => {
      if (skipNextResizeAdjustRef.current) {
        skipNextResizeAdjustRef.current = false;
        return;
      }
      adjustPolishPosition();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [polishVisible, adjustPolishPosition]);

  const centeredPos = showCentered ? getEditorCenterPos() : null;
  const centerStyle = {
    transform: "translate(-50%, -50%)",
    whiteSpace: "nowrap" as const,
  };

  return (
    <>
      {!polishVisible && !showCentered && (
        <BubbleMenu
          className={cssPrefix`container`}
          editor={editor}
          shouldShow={shouldShow}
          appendTo={document.body}
          options={{
            placement: "top",
            offset: 8,
            flip: false,
            shift: true,
            hide: false,
          }}
        >
          <Toolbar
            editor={editor}
            aiEnable={aiEnable}
            commentEnable={props.commentEnable}
            onOpenPolish={handleOpenPolish}
          />
        </BubbleMenu>
      )}

      {!polishVisible &&
        showCentered &&
        centeredPos &&
        createPortal(
          <div
            className={cssPrefix`polish-panel`}
            style={{
              top: centeredPos.top,
              left: centeredPos.left,
              ...centerStyle,
            }}
          >
            <Toolbar
              editor={editor}
              aiEnable={aiEnable}
              commentEnable={props.commentEnable}
              onOpenPolish={handleOpenPolish}
            />
          </div>,
          document.body,
        )}

      {polishVisible &&
        polishPos &&
        createPortal(
          <div
            ref={polishRef}
            className={cssPrefix`polish-panel`}
            style={{
              top: polishPos.top,
              left: polishPos.left,
              ...(polishCenteredRef.current ? centerStyle : undefined),
            }}
          >
            <AIPolishContent
              editor={editor}
              onClose={handleClosePolish}
              statusRef={polishStatusRef}
            />
          </div>,
          document.body,
        )}
    </>
  );
};

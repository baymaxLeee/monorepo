import { cn } from "@repo/shared";
import { type AnyExtension, flattenExtensions, type JSONContent } from "@tiptap/core";
import Code from "@tiptap/extension-code";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import { TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { EditorProvider } from "../../context";
import {
  createBlockDragExtension,
  createCodeBlockFallbackExtension,
  createCodeBlockExtension,
  createImageExtension,
  createIndentExtension,
  createPasteFlattenExtension,
  createSelectionPersistenceExtension,
  createTableCellExtension,
  createTableExtension,
  createTableHeaderExtension,
  createTableRowExtension,
  createTaskItemExtension,
  createTextAlignExtension,
} from "../../extensions";
import { TableCellMenu } from "../../extensions/Table/Menus/TableCell";
import { TableColumnMenu } from "../../extensions/Table/Menus/TableColumn";
import { TableRowMenu } from "../../extensions/Table/Menus/TableRow";
import { isCellSelection } from "../../extensions/Table/utils";
import {
  type ContentType,
  type Editor,
  type MarkdownEditorProps,
  type MarkdownEditorRef,
  MenuType,
} from "../../interface";
import { getMountedEditorDom } from "../../utils";
import { BlockMenu } from "../BlockMenu";
import { BubbleToolbar } from "../BubbleToolbar";
import { DragHandler } from "../DragHandler";
import { LinkMenu } from "../Link/LinkMenu";
import { FixedToolbar } from "../TopToolbar";

const EMPTY_EXTENSIONS: AnyExtension[] = [];
const OVERLAY_CONTENT_SELECTOR = '[data-slot="sheet-content"], [data-slot="dialog-content"]';

const parseEditorContent = (content: string, contentType: ContentType): string | JSONContent => {
  if (contentType !== "json" || content === "") {
    return content;
  }
  return JSON.parse(content) as JSONContent;
};

const serializeEditorContent = (editor: Editor, contentType: ContentType) => {
  if (contentType === "markdown") {
    return editor.getMarkdown();
  }
  if (contentType === "json") {
    return JSON.stringify(editor.getJSON());
  }
  return editor.getHTML();
};

const useShallowStableExtensions = (extensions: AnyExtension[]) => {
  const stableRef = useRef(extensions);

  if (
    stableRef.current.length !== extensions.length ||
    stableRef.current.some((extension, index) => extension !== extensions[index])
  ) {
    stableRef.current = extensions;
  }

  return stableRef.current;
};

const ensureUniqueExtensions = (extensions: AnyExtension[]) => {
  const names = new Set<string>();
  const duplicates = new Set<string>();
  for (const extension of flattenExtensions(extensions)) {
    if (names.has(extension.name)) {
      duplicates.add(extension.name);
    }
    names.add(extension.name);
  }
  if (duplicates.size > 0) {
    throw new Error(`MarkdownEditor received duplicate TipTap extensions: ${[...duplicates].join(", ")}`);
  }
  return extensions;
};

const MarkdownEditorInner = forwardRef<MarkdownEditorRef, MarkdownEditorProps>((props, ref) => {
  const {
    contentType = "html",
    toolbarMode = "bubble",
    extensions = EMPTY_EXTENSIONS,
    features,
    popupConfig,
    editable = false,
    value,
    defaultValue,
    placeholder,
    style,
    className,
    autoScrollToBottom,
    onChange,
    onAiPolish,
    onUpload,
    imageLoader,
    toolbarRender,
  } = props;
  const [maskVisible, setMaskVisible] = useState(false);
  const [menuType, setMenuType] = useState<MenuType>(MenuType.Toolbar);
  const isNearBottomRef = useRef(true);
  const isAutoScrollingRef = useRef(false);
  const lastSyncValueRef = useRef<string | undefined>(value);
  const runtimeOptionsRef = useRef({ imageLoader, onUpload, placeholder });
  runtimeOptionsRef.current = { imageLoader, onUpload, placeholder };
  const stableExtensions = useShallowStableExtensions(extensions);
  const codeBlockEnabled = features?.codeBlock !== false;
  const blockMenuEnabled = features?.blockMenu !== false;
  const blockDragEnabled = features?.blockDrag !== false;
  const blockGutterEnabled = editable && (blockMenuEnabled || blockDragEnabled);
  const resolvedFeatures = useMemo(
    () => ({
      blockDrag: blockDragEnabled,
      blockMenu: blockMenuEnabled,
      codeBlock: codeBlockEnabled,
    }),
    [blockDragEnabled, blockMenuEnabled, codeBlockEnabled],
  );
  const initialContent = useMemo(() => {
    const content = value ?? defaultValue;
    return content === undefined ? undefined : parseEditorContent(content, contentType);
  }, [contentType, defaultValue, value]);

  const editorExtensions = useMemo(() => {
    const resolvedExtensions: AnyExtension[] = [];
    const tableExtension = createTableExtension({
      getCellExtensions: () => resolvedExtensions,
    });

    resolvedExtensions.push(
      StarterKit.configure({
        code: false,
        codeBlock: false,
        dropcursor: false,
        link: {
          openOnClick: true,
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer",
          },
        },
      }),
      createImageExtension({
        getImageLoader: () => runtimeOptionsRef.current.imageLoader,
        getOnUpload: () => runtimeOptionsRef.current.onUpload,
      }),
      TextStyle,
      Code.extend({
        excludes: contentType === "markdown" ? "_" : "",
      }),
      Color.configure({
        types: [TextStyle.name],
      }),
      Highlight.configure({ multicolor: true }).extend({
        priority: 10000,
        renderHTML({ HTMLAttributes }) {
          return ["mark", HTMLAttributes, 0];
        },
      }),
      createTextAlignExtension(),
      tableExtension,
      createTableRowExtension(),
      createTableHeaderExtension({ showTableGrip: !blockDragEnabled }),
      createTableCellExtension(),
      TaskList,
      Markdown,
      createTaskItemExtension(),
      Placeholder.configure({ placeholder: () => runtimeOptionsRef.current.placeholder ?? "" }),
      createIndentExtension().configure({ contentType }),
      ...(codeBlockEnabled ? [createCodeBlockExtension()] : [createCodeBlockFallbackExtension()]),
      ...(blockDragEnabled ? [createBlockDragExtension()] : []),
      createSelectionPersistenceExtension(),
      createPasteFlattenExtension({ codeBlock: codeBlockEnabled }),
      ...stableExtensions,
    );

    return ensureUniqueExtensions(resolvedExtensions);
  }, [blockDragEnabled, codeBlockEnabled, contentType, stableExtensions]);

  const handleEditorUpdate = useCallback(
    ({ editor }: { editor: Editor }) => {
      if (editor.isDestroyed || typeof onChange !== "function") {
        return;
      }
      const data = serializeEditorContent(editor, contentType);
      onChange(data);
      lastSyncValueRef.current = data;
    },
    [contentType, onChange],
  );

  const handleSelectionUpdate = useCallback(({ editor }: { editor: Editor }) => {
    const { selection } = editor.state;
    if (!isCellSelection(selection)) {
      setMenuType(MenuType.Toolbar);
      return;
    }

    if (selection.isColSelection()) {
      setMenuType(MenuType.TableColumn);
    } else if (selection.isRowSelection()) {
      setMenuType(MenuType.TableRow);
    } else {
      setMenuType(MenuType.TableCell);
    }
  }, []);

  const editor = useEditor(
    {
      extensions: editorExtensions,
      content: initialContent,
      editable,
      contentType,
      onUpdate: handleEditorUpdate,
      onSelectionUpdate: handleSelectionUpdate,
    },
    [editorExtensions],
  );

  const portal = useMemo(
    () => ({
      getPopupContainer: () => {
        const editorDom = getMountedEditorDom(editor);
        return editorDom ? popupConfig?.getContainer?.(editorDom) : undefined;
      },
      getMenuContainer: () => {
        const editorDom = getMountedEditorDom(editor);
        if (!editorDom) {
          return document.body;
        }
        return (
          popupConfig?.getContainer?.(editorDom) ??
          (editorDom.closest(OVERLAY_CONTENT_SELECTOR) as HTMLElement | null) ??
          editorDom.ownerDocument.body
        );
      },
    }),
    [editor, popupConfig?.getContainer],
  );

  useImperativeHandle(
    ref,
    () => ({
      editor,
    }),
    [editor],
  );

  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable !== editable) {
      if (!editable && blockDragEnabled) {
        editor.commands.clearBlockDrag();
      }
      editor.setEditable(editable, false);
    }
  }, [blockDragEnabled, editable, editor]);

  useEffect(() => {
    if (!autoScrollToBottom) {
      return;
    }

    const proseMirrorDom = getMountedEditorDom(editor);
    if (!proseMirrorDom) {
      return;
    }

    const scrollContainer = proseMirrorDom.parentElement;
    if (!scrollContainer) {
      return;
    }

    const lineHeight = parseFloat(getComputedStyle(scrollContainer).lineHeight) || 22;

    const onScroll = () => {
      if (isAutoScrollingRef.current) {
        isAutoScrollingRef.current = false;
        isNearBottomRef.current = true;
        return;
      }
      const { scrollHeight, scrollTop, clientHeight } = scrollContainer;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight <= lineHeight;
    };

    const onResize = () => {
      if (isNearBottomRef.current) {
        isAutoScrollingRef.current = true;
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    };

    scrollContainer.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(proseMirrorDom);

    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [editor, autoScrollToBottom]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    if (value === undefined || value === lastSyncValueRef.current) {
      return;
    }
    lastSyncValueRef.current = value;
    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta("addToHistory", false);
        return true;
      })
      .setContent(parseEditorContent(value, contentType), { contentType, emitUpdate: false })
      .run();
  }, [value, editor, contentType]);

  const renderToolbar = () => {
    if (menuType === MenuType.TableCell) {
      if (contentType === "markdown") {
        return null;
      }
      return <TableCellMenu editor={editor} />;
    } else if (menuType === MenuType.TableColumn) {
      return <TableColumnMenu editor={editor} />;
    } else if (menuType === MenuType.TableRow) {
      return <TableRowMenu editor={editor} />;
    }

    if (toolbarMode === "bubble" || onAiPolish) {
      return <BubbleToolbar editor={editor} aiOnly={toolbarMode === "fixed"} />;
    }

    return null;
  };

  return (
    <div
      className={cn(
        "markdown-editor text-sm text-foreground",
        editable && "markdown-editor-editable",
        blockGutterEnabled && "markdown-editor-with-block-gutter",
        className,
      )}
      style={style}
    >
      {maskVisible && <div className="markdown-editor-mask" />}
      <EditorProvider
        maskVisible={maskVisible}
        setMaskVisible={setMaskVisible}
        onAiPolish={onAiPolish}
        onUpload={onUpload}
        contentType={contentType}
        toolbarMode={toolbarMode}
        features={resolvedFeatures}
        portal={portal}
        toolbarRender={toolbarRender}
        editable={editable}
      >
        {editable && editor && (
          <>
            {toolbarMode === "fixed" && <FixedToolbar editor={editor} />}
            {blockMenuEnabled && <BlockMenu editor={editor} />}
            {blockDragEnabled && <DragHandler editor={editor} />}
            <LinkMenu editor={editor} />
            {renderToolbar()}
          </>
        )}
        <EditorContent editor={editor} className="markdown-editor-content" />
      </EditorProvider>
    </div>
  );
});

MarkdownEditorInner.displayName = "MarkdownEditor";

export const MarkdownEditor = memo(MarkdownEditorInner);

export default MarkdownEditor;

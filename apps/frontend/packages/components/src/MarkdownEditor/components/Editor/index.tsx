import type { AnyExtension } from "@tiptap/core";
import Code from "@tiptap/extension-code";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import { TextStyle } from "@tiptap/extension-text-style";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "shared";
import { EditorProvider } from "../../context";
import {
  createBlockDragExtension,
  createCodeBlockExtension,
  createCommentExtension,
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

const normalizeMarkdownContent = (
  content: string | undefined,
  contentType: ContentType,
  parseHtml: boolean,
) => {
  if (!content || contentType !== "markdown" || parseHtml) {
    return content;
  }

  const escapeMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
  };
  return content.replace(/[&<>]/g, (ch) => escapeMap[ch]);
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
    stableRef.current.some(
      (extension, index) => extension !== extensions[index],
    )
  ) {
    stableRef.current = extensions;
  }

  return stableRef.current;
};

const MarkdownEditorInner = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(
  (props, ref) => {
    const {
      contentType = "html",
      parseHtml = true,
      toolbarMode = "bubble",
      extensions = EMPTY_EXTENSIONS,
      editable = false,
      aiEnable = false,
      commentEnable = false,
      value,
      defaultValue,
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
    const [viewReady, setViewReady] = useState(false);
    const isNearBottomRef = useRef(true);
    const isAutoScrollingRef = useRef(false);
    const externalSyncFrameRef = useRef<number | null>(null);
    const lastSyncValueRef = useRef<string | undefined>();
    const stableExtensions = useShallowStableExtensions(extensions);
    const initialContent = useMemo(() => {
      return normalizeMarkdownContent(
        value ?? defaultValue,
        contentType,
        parseHtml,
      );
    }, [contentType, defaultValue, parseHtml, value]);

    const editorExtensions = useMemo(
      () => [
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
        createImageExtension({ onUpload, imageLoader }),
        TextStyle,
        Code.extend({
          excludes: contentType === "markdown" ? "_" : "", // markdown 模式下，code 不允许与其他 mark 共存，避免冲突,
        }),
        Color.configure({
          types: [TextStyle.name],
        }),
        Highlight.configure({ multicolor: true }).extend({
          priority: 10000, // 显著高于 TextStyle (100)，确保 mark 包裹 span
          renderHTML({ HTMLAttributes }) {
            return ["mark", HTMLAttributes, 0];
          },
        }),
        createTextAlignExtension(),
        createTableExtension(),
        createTableRowExtension(),
        createTableHeaderExtension(),
        createTableCellExtension(),
        TaskList,
        Markdown,
        createTaskItemExtension(),
        // 自定义扩展
        createCommentExtension(),
        createIndentExtension().configure({ contentType }),
        createCodeBlockExtension(),
        ...(editable
          ? [createBlockDragExtension(), createSelectionPersistenceExtension()]
          : []),
        createPasteFlattenExtension(),
        ...stableExtensions,
      ],
      // 故意只依赖 [contentType, editable, stableExtensions]：onUpload / imageLoader
      // 通过 ref / closure 捕获，避免父组件每次传新回调都重建 editor extensions
      [contentType, editable, stableExtensions],
    );

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

    const handleSelectionUpdate = useCallback(
      ({ editor }: { editor: Editor }) => {
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
      },
      [],
    );

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

    useImperativeHandle(
      ref,
      () => ({
        editor,
      }),
      [editor],
    );

    // 父级 effect 在 EditorContent 挂载 view 之后执行，确保菜单组件渲染时 view 已就绪
    useEffect(() => {
      setViewReady(!!editor);
    }, [editor]);

    // SSE 流式模式自动滚动：监听内容高度变化，用户在底部附近时自动滚动
    useEffect(() => {
      if (!autoScrollToBottom) return;

      const proseMirrorDom = getMountedEditorDom(editor);
      if (!proseMirrorDom) return;

      const scrollContainer = proseMirrorDom.parentElement;
      if (!scrollContainer) return;

      const lineHeight =
        parseFloat(getComputedStyle(scrollContainer).lineHeight) || 22;

      const onScroll = () => {
        if (isAutoScrollingRef.current) {
          isAutoScrollingRef.current = false;
          isNearBottomRef.current = true;
          return;
        }
        const { scrollHeight, scrollTop, clientHeight } = scrollContainer;
        isNearBottomRef.current =
          scrollHeight - scrollTop - clientHeight <= lineHeight;
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

    // 受控模式：外部 value 变化时同步到编辑器
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      const normalizedValue = normalizeMarkdownContent(
        value,
        contentType,
        parseHtml,
      );
      if (
        typeof normalizedValue !== "string" ||
        normalizedValue === lastSyncValueRef.current
      )
        return; // 避免不必要的 setContent 调用
      if (externalSyncFrameRef.current !== null) {
        cancelAnimationFrame(externalSyncFrameRef.current);
        externalSyncFrameRef.current = null;
      }

      externalSyncFrameRef.current = requestAnimationFrame(() => {
        externalSyncFrameRef.current = null;
        if (editor.isDestroyed) {
          return;
        }
        lastSyncValueRef.current = normalizedValue;
        editor
          .chain()
          .command(({ tr }) => {
            tr.setMeta("addToHistory", false);
            return true;
          })
          .setContent(normalizedValue, { contentType, emitUpdate: false })
          .run();
      });

      return () => {
        if (externalSyncFrameRef.current !== null) {
          cancelAnimationFrame(externalSyncFrameRef.current);
          externalSyncFrameRef.current = null;
        }
      };
    }, [value, editor, contentType, parseHtml]);

    useEffect(() => {
      return () => {
        if (externalSyncFrameRef.current !== null) {
          cancelAnimationFrame(externalSyncFrameRef.current);
        }
      };
    }, []);

    const renderToolbar = () => {
      if (menuType === MenuType.TableCell) {
        if (contentType === "markdown") return null;
        return <TableCellMenu editor={editor} />;
      } else if (menuType === MenuType.TableColumn) {
        return <TableColumnMenu editor={editor} />;
      } else if (menuType === MenuType.TableRow) {
        return <TableRowMenu editor={editor} />;
      }

      if (toolbarMode === "bubble") {
        return (
          <BubbleToolbar
            editor={editor}
            aiEnable={aiEnable}
            commentEnable={commentEnable}
          />
        );
      }

      return null;
    };

    return (
      <div
        className={cn(
          "markdown-editor text-sm text-foreground",
          editable && "markdown-editor-editable",
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
          toolbarRender={toolbarRender}
          editable={editable}
        >
          {editable && viewReady && (
            <>
              {toolbarMode === "fixed" && (
                <FixedToolbar
                  editor={editor}
                  aiEnable={aiEnable}
                  commentEnable={commentEnable}
                />
              )}
              <BlockMenu editor={editor} />
              <DragHandler editor={editor} />
              <LinkMenu editor={editor} />
              {renderToolbar()}
            </>
          )}
          <EditorContent editor={editor} className="markdown-editor-content" />
        </EditorProvider>
      </div>
    );
  },
);

MarkdownEditorInner.displayName = "MarkdownEditor";

export const MarkdownEditor = memo(MarkdownEditorInner);

export default MarkdownEditor;

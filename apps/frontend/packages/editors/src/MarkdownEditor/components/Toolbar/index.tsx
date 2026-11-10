import { toast } from "@repo/design-system";
import { Button } from "@repo/design-system/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/design-system/shadcn/dropdown-menu";
import { Input } from "@repo/design-system/shadcn/input";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/design-system/shadcn/popover";
import { Tooltip, TooltipTrigger } from "@repo/design-system/shadcn/tooltip";
import { cn } from "@repo/shared";
import { type Editor, useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code,
  Code2,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image as ImageIcon,
  Indent,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Outdent,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { ALLOWED_IMAGE_ACCEPT, BG_COLORS, FONT_COLORS, isAllowedImageFile, URL_REGEX } from "../../constants";
import { useEditorContext } from "../../context";
import { type ContentType, type ToolbarMode } from "../../interface";
import { getFullUrl } from "../../utils";
import { AIPolishTrigger } from "../AIPolishPanel/AIPolishTrigger";
import { EditorTooltipContent } from "../EditorTooltipContent";
import { TableSelector } from "../TableSelector";

interface IProps {
  editor: Editor;
  aiOnly?: boolean;
  onOpenPolish?: () => void;
}

const colorNormalizer = typeof document !== "undefined" ? document.createElement("div") : null;

/**
 * 普通图标按钮（B/I/U/S/Code/Link 等）。
 * active 仅改文字色，
 * 蓝色文字 + hover 浅灰底，跟原 Arco 工具栏视觉一致。
 */
function btnCls(opts?: { isActive?: boolean; isDisabled?: boolean }) {
  const { isActive = false, isDisabled = false } = opts ?? {};
  return cn(
    "inline-flex size-7 select-none items-center justify-center rounded-md transition-colors [&>svg]:size-4",
    isDisabled
      ? "pointer-events-none cursor-not-allowed text-muted-foreground/50 opacity-50"
      : "cursor-pointer hover:bg-accent",
    isActive && !isDisabled && "text-blue-600",
  );
}

/** trigger 按钮（带 ChevronDown 的下拉触发器） */
function triggerCls(opts?: { isActive?: boolean; isDisabled?: boolean }) {
  const { isActive = false, isDisabled = false } = opts ?? {};
  return cn(
    "group/trigger inline-flex h-7 select-none items-center justify-center gap-1 rounded-md px-1.5 transition-colors",
    "[&>svg]:size-4 [&>svg.icon-down]:size-3 [&>svg.icon-down]:text-muted-foreground [&>svg.icon-down]:transition-transform",
    isDisabled
      ? "pointer-events-none cursor-not-allowed text-muted-foreground/50 opacity-50"
      : "cursor-pointer hover:bg-accent data-popup-open:bg-accent data-popup-open:[&>svg.icon-down]:rotate-180",
    isActive && !isDisabled && "text-blue-600",
  );
}

/** 工具栏内的竖向分隔线 */
const dividerCls = "mx-1 h-4 w-px shrink-0 bg-border";

function preventToolbarMouseDown(event: React.MouseEvent) {
  event.preventDefault();
}

export function getActiveNodeType(editor: Editor, toolbarMode: ToolbarMode): string {
  if (toolbarMode === "bubble") {
    if (editor.isActive("codeBlock")) {
      return "codeBlock";
    }
    if (editor.isActive("orderedList")) {
      return "orderedList";
    }
    if (editor.isActive("taskList")) {
      return "taskList";
    }
    if (editor.isActive("bulletList")) {
      return "bulletList";
    }
    if (editor.isActive("blockquote")) {
      return "blockquote";
    }
  }
  for (let i = 1; i <= 6; i++) {
    if (editor.isActive("heading", { level: i })) {
      return `h${i}`;
    }
  }
  return "paragraph";
}

export function getActiveTextAlign(editor: Editor): string {
  if (editor.isActive({ textAlign: "center" })) {
    return "center";
  }
  if (editor.isActive({ textAlign: "right" })) {
    return "right";
  }
  return "left";
}

export function computeCanChangeType(editor: Editor, contentType: ContentType): boolean {
  const { $from, $to } = editor.state.selection;
  if (contentType === "markdown") {
    for (let d = $from.depth; d >= 0; d--) {
      const name = $from.node(d).type.name;
      if (name === "tableCell" || name === "tableHeader") {
        return false;
      }
    }
  }
  if ($from.parent === $to.parent) {
    return true;
  }
  let allParagraph = true;
  editor.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
    if (!allParagraph) {
      return false;
    }
    if (node.isTextblock) {
      const $pos = editor.state.doc.resolve(pos);
      const topNode = $pos.depth >= 1 ? $pos.node(1) : node;
      if (topNode.type.name !== "paragraph") {
        allParagraph = false;
      }
    }
    return true;
  });
  return allParagraph;
}

export function computeIsTableContext(editor: Editor): boolean {
  const { $from } = editor.state.selection;

  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "table" || name === "tableRow" || name === "tableCell" || name === "tableHeader") {
      return true;
    }
  }

  return false;
}

export function getNodeTypeIcon(nodeType: string) {
  switch (nodeType) {
    case "codeBlock":
      return <Code2 />;
    case "orderedList":
      return <ListOrdered />;
    case "taskList":
      return <ListChecks />;
    case "bulletList":
      return <List />;
    case "h1":
      return <Heading1 />;
    case "h2":
      return <Heading2 />;
    case "h3":
      return <Heading3 />;
    case "h4":
      return <Heading4 />;
    case "h5":
      return <Heading5 />;
    case "h6":
      return <Heading6 />;
    case "blockquote":
      return <Quote />;
    default:
      return <Pilcrow />;
  }
}

export function getAlignIcon(align: string) {
  switch (align) {
    case "center":
      return <AlignCenter />;
    case "right":
      return <AlignRight />;
    default:
      return <AlignLeft />;
  }
}

export const normalizeColor = (color: string) => {
  if (!colorNormalizer) {
    return color;
  }
  colorNormalizer.style.color = color;
  return colorNormalizer.style.color;
};

export const ColorPickerContent = ({ editor, onClose }: { editor: Editor; onClose: () => void }) => {
  const isColorActive = (color: string) => {
    const currentColor = editor.getAttributes("textStyle").color;
    if (color === "inherit") {
      return !currentColor;
    }
    if (!currentColor) {
      return false;
    }
    return normalizeColor(currentColor) === normalizeColor(color);
  };

  const isBgActive = (color: string) => {
    const currentBg = editor.getAttributes("highlight").color;
    if (color === "transparent") {
      return !currentBg;
    }
    if (!currentBg) {
      return false;
    }
    return normalizeColor(currentBg) === normalizeColor(color);
  };

  const handleSetColor = (color: string) => {
    if (color === "inherit") {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().setColor(color).run();
    }
    onClose();
  };

  const handleSetBg = (color: string) => {
    if (color === "transparent") {
      editor.chain().focus().unsetHighlight().run();
    } else {
      editor.chain().focus().setHighlight({ color }).run();
    }
    onClose();
  };

  return (
    <div className="flex w-60 flex-col gap-3">
      <div>
        <div className="mb-2 px-1 text-xs text-muted-foreground">字体颜色</div>
        <div className="grid grid-cols-8 gap-1.5 px-1">
          {FONT_COLORS.map((item) => (
            <Tooltip key={item.color}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "flex size-6 cursor-pointer items-center justify-center rounded border border-border transition-all",
                      isColorActive(item.color) ? "border-blue-600" : "hover:border-blue-600/60",
                    )}
                    onClick={() => handleSetColor(item.color)}
                  />
                }
              >
                <span className="text-sm font-medium leading-none" style={{ color: item.color }}>
                  A
                </span>
              </TooltipTrigger>
              <EditorTooltipContent>{item.label}</EditorTooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 px-1 text-xs text-muted-foreground">背景颜色</div>
        <div className="grid grid-cols-8 gap-1.5 px-1">
          {BG_COLORS.map((item) => (
            <Tooltip key={item.color}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "group/bg relative flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded border border-transparent transition-all",
                      isBgActive(item.color)
                        ? "scale-[0.85] border-blue-600"
                        : "hover:scale-[0.85] hover:border-blue-600/60",
                    )}
                    onClick={() => handleSetBg(item.color)}
                  />
                }
              >
                <div
                  className="absolute inset-0 rounded-sm transition-transform group-hover/bg:scale-95 group-hover/bg:outline group-hover/bg:outline-2 group-hover/bg:outline-white group-active/bg:scale-90"
                  style={{ backgroundColor: item.color }}
                >
                  {item.color === "transparent" && (
                    <div className="relative size-full overflow-hidden rounded-sm border border-border">
                      <div className="absolute left-0 top-0 h-px w-[141%] origin-top-left rotate-45 bg-muted-foreground" />
                    </div>
                  )}
                </div>
              </TooltipTrigger>
              <EditorTooltipContent>{item.label}</EditorTooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="px-1">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => editor.chain().focus().unsetColor().unsetHighlight().run()}
        >
          恢复默认
        </Button>
      </div>
    </div>
  );
};

const AlignDropdownItems = ({ editor, textAlign }: { editor: Editor; textAlign: string }) => {
  const runListIndent = (direction: "indent" | "outdent") => {
    if (editor.isActive("taskItem")) {
      return editor.chain().focus()[direction === "indent" ? "sinkListItem" : "liftListItem"]("taskItem").run();
    }
    if (editor.isActive("listItem")) {
      return editor.chain().focus()[direction === "indent" ? "sinkListItem" : "liftListItem"]("listItem").run();
    }
    return editor.chain().focus()[direction]().run();
  };

  const handle = (key: "left" | "center" | "right" | "outdent" | "indent") => {
    switch (key) {
      case "left":
      case "center":
      case "right":
        editor.chain().focus().setTextAlign(key).run();
        break;
      case "outdent":
        if (!runListIndent("outdent")) {
          toast.add({ type: "warning", title: "已达到最小缩进层级" });
        }
        break;
      case "indent":
        if (!runListIndent("indent")) {
          toast.add({ type: "warning", title: "已达到最大缩进层级" });
        }
        break;
    }
  };

  const itemCls = (active: boolean) =>
    cn("gap-2 [&>svg]:size-4", active && "font-medium text-blue-600 focus:text-blue-600");

  return (
    <>
      <DropdownMenuItem onClick={() => handle("left")} className={itemCls(textAlign === "left")}>
        <AlignLeft />
        左对齐
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => handle("center")} className={itemCls(textAlign === "center")}>
        <AlignCenter />
        居中对齐
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => handle("right")} className={itemCls(textAlign === "right")}>
        <AlignRight />
        右对齐
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => handle("outdent")} className="gap-2 [&>svg]:size-4">
        <Outdent />
        减少缩进
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => handle("indent")} className="gap-2 [&>svg]:size-4">
        <Indent />
        增加缩进
      </DropdownMenuItem>
    </>
  );
};

const NodeTypeDropdownItems = ({
  editor,
  activeNodeType,
  toolbarMode,
}: {
  editor: Editor;
  activeNodeType: string;
  toolbarMode: ToolbarMode;
}) => {
  const { features } = useEditorContext();
  const codeBlockEnabled = features.codeBlock;
  const handle = (key: string) => {
    let chain = editor.chain().focus();

    if (editor.isActive("bulletList")) {
      chain = chain.toggleBulletList();
    }
    if (editor.isActive("orderedList")) {
      chain = chain.toggleOrderedList();
    }
    if (editor.isActive("taskList")) {
      chain = chain.toggleTaskList();
    }
    if (editor.isActive("blockquote")) {
      chain = chain.toggleBlockquote();
    }
    if (editor.isActive("codeBlock")) {
      chain = chain.toggleCodeBlock();
    }
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive("heading", { level: i })) {
        chain = chain.setParagraph();
        break;
      }
    }

    switch (key) {
      case "paragraph":
        chain.setParagraph().run();
        break;
      case "codeBlock":
        chain.toggleCodeBlock().run();
        break;
      case "orderedList":
        chain.toggleOrderedList().run();
        break;
      case "taskList":
        chain.toggleTaskList().run();
        break;
      case "bulletList":
        chain.toggleBulletList().run();
        break;
      case "blockquote":
        chain.toggleBlockquote().run();
        break;
      default:
        if (key.startsWith("h")) {
          const level = parseInt(key.replace("h", ""), 10);
          if (!Number.isNaN(level)) {
            chain.toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
          }
        }
    }
  };

  const itemCls = (key: string) =>
    cn("gap-2 [&>svg]:size-4", activeNodeType === key && "font-medium text-blue-600 focus:text-blue-600");

  return (
    <>
      <DropdownMenuItem onClick={() => handle("paragraph")} className={itemCls("paragraph")}>
        <Pilcrow />
        正文
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => handle("h1")} className={itemCls("h1")}>
        <Heading1 />
        一级标题
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => handle("h2")} className={itemCls("h2")}>
        <Heading2 />
        二级标题
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => handle("h3")} className={itemCls("h3")}>
        <Heading3 />
        三级标题
      </DropdownMenuItem>
      {toolbarMode === "bubble" ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 [&>svg]:size-4">
            <Heading />
            其他标题
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => handle("h4")} className={itemCls("h4")}>
              <Heading4 />
              四级标题
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handle("h5")} className={itemCls("h5")}>
              <Heading5 />
              五级标题
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handle("h6")} className={itemCls("h6")}>
              <Heading6 />
              六级标题
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : (
        <>
          <DropdownMenuItem onClick={() => handle("h4")} className={itemCls("h4")}>
            <Heading4 />
            四级标题
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle("h5")} className={itemCls("h5")}>
            <Heading5 />
            五级标题
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle("h6")} className={itemCls("h6")}>
            <Heading6 />
            六级标题
          </DropdownMenuItem>
        </>
      )}
      {toolbarMode === "bubble" && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handle("bulletList")} className={itemCls("bulletList")}>
            <List />
            无序列表
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle("orderedList")} className={itemCls("orderedList")}>
            <ListOrdered />
            有序列表
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle("taskList")} className={itemCls("taskList")}>
            <ListChecks />
            任务列表
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handle("blockquote")} className={itemCls("blockquote")}>
            <Quote />
            引用
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {codeBlockEnabled ? (
            <DropdownMenuItem onClick={() => handle("codeBlock")} className={itemCls("codeBlock")}>
              <Code2 />
              代码块
            </DropdownMenuItem>
          ) : null}
        </>
      )}
    </>
  );
};

interface ToolbarContentProps {
  editor: Editor;
  onOpenPolish?: () => void;
}

const ToolbarContent = ({ editor, onOpenPolish }: ToolbarContentProps) => {
  const { features, contentType, toolbarMode, toolbarRender, onUpload, portal } = useEditorContext();
  const codeBlockEnabled = features.codeBlock;
  const [linkUrl, setLinkUrl] = useState("");
  const [linkVisible, setLinkVisible] = useState(false);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const overlayContainer = portal.getPopupContainer();

  const handleImageClick = () => {
    if (editorState.isImage) {
      editor.chain().focus().deleteSelection().run();
      return;
    }
    imageInputRef.current?.click();
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isAllowedImageFile);
    if (files.length > 0) {
      editor.chain().focus().insertImages(files).run();
    }
    e.target.value = "";
  };

  const editorState = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor;
      const can = e.can();
      return {
        isBold: e.isActive("bold"),
        isItalic: e.isActive("italic"),
        isUnderline: e.isActive("underline"),
        isStrike: e.isActive("strike"),
        isCode: e.isActive("code"),
        isLink: e.isActive("link"),
        isBulletList: e.isActive("bulletList"),
        isOrderedList: e.isActive("orderedList"),
        isTaskList: e.isActive("taskList"),
        isBlockquote: e.isActive("blockquote"),
        isCodeBlock: e.isActive("codeBlock"),
        isTable: computeIsTableContext(e),
        isImage: e.isActive("image"),
        activeNodeType: getActiveNodeType(e, toolbarMode),
        textAlign: getActiveTextAlign(e),
        canBold: can.toggleBold(),
        canItalic: can.toggleItalic(),
        canUnderline: can.toggleUnderline(),
        canStrike: can.toggleStrike(),
        canCode: can.toggleCode(),
        canLink: can.setLink({ href: "" }),
        canAlign: can.setTextAlign?.("left") ?? false,
        canUndo: can.undo(),
        canRedo: can.redo(),
        canColor: !!(can.setColor?.("#000") && can.setHighlight?.({ color: "#000" })),
        currentColor: (e.getAttributes("textStyle").color as string | undefined) ?? null,
        currentBg: (e.getAttributes("highlight").color as string | undefined) ?? null,
        canChangeType: computeCanChangeType(e, contentType),
      };
    },
    equalityFn: (prev, next) => {
      if (!prev || !next) {
        return prev === next;
      }
      return (
        prev.isBold === next.isBold &&
        prev.isItalic === next.isItalic &&
        prev.isUnderline === next.isUnderline &&
        prev.isStrike === next.isStrike &&
        prev.isCode === next.isCode &&
        prev.isLink === next.isLink &&
        prev.isBulletList === next.isBulletList &&
        prev.isOrderedList === next.isOrderedList &&
        prev.isTaskList === next.isTaskList &&
        prev.isBlockquote === next.isBlockquote &&
        prev.isCodeBlock === next.isCodeBlock &&
        prev.isTable === next.isTable &&
        prev.isImage === next.isImage &&
        prev.activeNodeType === next.activeNodeType &&
        prev.textAlign === next.textAlign &&
        prev.canBold === next.canBold &&
        prev.canItalic === next.canItalic &&
        prev.canUnderline === next.canUnderline &&
        prev.canStrike === next.canStrike &&
        prev.canCode === next.canCode &&
        prev.canLink === next.canLink &&
        prev.canAlign === next.canAlign &&
        prev.canUndo === next.canUndo &&
        prev.canRedo === next.canRedo &&
        prev.canColor === next.canColor &&
        prev.currentColor === next.currentColor &&
        prev.currentBg === next.currentBg &&
        prev.canChangeType === next.canChangeType
      );
    },
  });

  const setLink = () => {
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: getFullUrl(linkUrl), target: "_blank" })
      .run();
    setLinkVisible(false);
    setLinkUrl("");
  };

  const linkInvalid = useMemo(() => !URL_REGEX.test(linkUrl), [linkUrl]);

  /** 包装 IconButton + Tooltip 的统一封装 */
  const IconBtn = ({
    label,
    icon,
    isActive,
    isDisabled,
    onClick,
  }: {
    label: string;
    icon: React.ReactNode;
    isActive?: boolean;
    isDisabled?: boolean;
    onClick: () => void;
  }) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={!!isActive}
            aria-disabled={!!isDisabled}
            className={btnCls({ isActive, isDisabled })}
            onClick={() => {
              if (isDisabled) {
                return;
              }
              onClick();
            }}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <EditorTooltipContent>{label}</EditorTooltipContent>
    </Tooltip>
  );

  return (
    <div
      className="flex h-9 select-none items-center px-1 text-sm leading-tight text-foreground"
      onMouseDownCapture={preventToolbarMouseDown}
    >
      {onOpenPolish && <AIPolishTrigger editor={editor} onOpen={onOpenPolish} showDivider />}
      {toolbarMode === "fixed" && (
        <>
          <IconBtn
            label="撤销"
            icon={<Undo2 />}
            isDisabled={!editorState.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          />
          <IconBtn
            label="重做"
            icon={<Redo2 />}
            isDisabled={!editorState.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          />
          <span className={dividerCls} />
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          openOnHover
          type="button"
          aria-label="节点类型"
          disabled={!editorState.canChangeType}
          className={triggerCls({
            isDisabled: !editorState.canChangeType,
          })}
        >
          {getNodeTypeIcon(editorState.activeNodeType)}
          <ChevronDown className="icon-down" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-32" container={overlayContainer}>
          <NodeTypeDropdownItems
            editor={editor}
            activeNodeType={editorState.activeNodeType}
            toolbarMode={toolbarMode}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {contentType !== "markdown" && (
        <>
          <span className={dividerCls} />
          <DropdownMenu>
            <DropdownMenuTrigger
              openOnHover
              type="button"
              aria-label="对齐方式"
              disabled={!editorState.canAlign}
              className={triggerCls({
                isDisabled: !editorState.canAlign,
              })}
            >
              {getAlignIcon(editorState.textAlign)}
              <ChevronDown className="icon-down" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-28" container={overlayContainer}>
              <AlignDropdownItems editor={editor} textAlign={editorState.textAlign} />
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <span className={dividerCls} />
      <IconBtn
        label="加粗"
        icon={<Bold />}
        isActive={editorState.isBold}
        isDisabled={!editorState.canBold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <IconBtn
        label="斜体"
        icon={<Italic />}
        isActive={editorState.isItalic}
        isDisabled={!editorState.canItalic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <IconBtn
        label="下划线"
        icon={<Underline />}
        isActive={editorState.isUnderline}
        isDisabled={!editorState.canUnderline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <IconBtn
        label="删除线"
        icon={<Strikethrough />}
        isActive={editorState.isStrike}
        isDisabled={!editorState.canStrike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <IconBtn
        label="代码"
        icon={<Code />}
        isActive={editorState.isCode}
        isDisabled={!editorState.canCode}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <Popover
        open={linkVisible}
        onOpenChange={(v) => {
          setLinkVisible(v);
          if (!v) {
            setLinkUrl("");
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                type="button"
                disabled={!editorState.canLink}
                aria-label="链接"
                className={btnCls({
                  isActive: editorState.isLink,
                  isDisabled: !editorState.canLink,
                })}
              />
            }
          >
            <Link2 />
          </TooltipTrigger>
          <EditorTooltipContent>链接</EditorTooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="w-64 p-3" container={overlayContainer} initialFocus={false}>
          <Input
            autoFocus
            placeholder="输入链接地址..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !linkInvalid) {
                e.preventDefault();
                setLink();
              }
            }}
            className="mb-2"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLinkVisible(false);
                setLinkUrl("");
              }}
            >
              取消
            </Button>
            <Button size="sm" onClick={setLink} disabled={linkInvalid}>
              确认
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {contentType !== "markdown" && (
        <Popover open={colorPickerVisible} onOpenChange={setColorPickerVisible}>
          <PopoverTrigger
            openOnHover
            type="button"
            disabled={!editorState.canColor}
            aria-label="字体与背景色"
            className={triggerCls({
              isDisabled: !editorState.canColor,
            })}
          >
            <span
              className="inline-flex size-4 items-center justify-center rounded-sm text-sm font-semibold leading-none"
              style={{
                color: editorState.currentColor || FONT_COLORS[0].color,
                backgroundColor: editorState.currentBg || BG_COLORS[0].color,
              }}
            >
              A
            </span>
            <ChevronDown className="icon-down" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3" container={overlayContainer}>
            <ColorPickerContent editor={editor} onClose={() => setColorPickerVisible(false)} />
          </PopoverContent>
        </Popover>
      )}
      <span className={dividerCls} />
      {toolbarMode === "fixed" && (
        <>
          <IconBtn
            label="无序列表"
            icon={<List />}
            isActive={editorState.isBulletList}
            isDisabled={!editorState.canChangeType}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <IconBtn
            label="有序列表"
            icon={<ListOrdered />}
            isActive={editorState.isOrderedList}
            isDisabled={!editorState.canChangeType}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <IconBtn
            label="任务列表"
            icon={<ListChecks />}
            isActive={editorState.isTaskList}
            isDisabled={!editorState.canChangeType}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          />
          <IconBtn
            label="引用"
            icon={<Quote />}
            isActive={editorState.isBlockquote}
            isDisabled={!editorState.canChangeType}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
          {codeBlockEnabled ? (
            <IconBtn
              label="代码块"
              icon={<Code2 />}
              isActive={editorState.isCodeBlock}
              isDisabled={!editorState.canChangeType}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            />
          ) : null}
          {editorState.isTable ? (
            <IconBtn
              label="删除表格"
              icon={<TableIcon />}
              isActive
              onClick={() => editor.chain().focus().deleteTable().run()}
            />
          ) : (
            <Popover>
              <Tooltip>
                <TooltipTrigger render={<PopoverTrigger type="button" aria-label="插入表格" className={btnCls()} />}>
                  <TableIcon />
                </TooltipTrigger>
                <EditorTooltipContent>插入表格</EditorTooltipContent>
              </Tooltip>
              <PopoverContent align="start" className="w-auto p-2" container={overlayContainer}>
                <TableSelector
                  onSelect={(rows, cols) => {
                    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
                  }}
                />
              </PopoverContent>
            </Popover>
          )}
          {onUpload && (
            <IconBtn
              label={editorState.isImage ? "删除图片" : "插入图片"}
              icon={<ImageIcon />}
              isActive={editorState.isImage}
              onClick={handleImageClick}
            />
          )}
        </>
      )}
      {toolbarMode === "bubble" && (
        <>
          <IconBtn
            label="撤销"
            icon={<Undo2 />}
            isDisabled={!editorState.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          />
          <IconBtn
            label="重做"
            icon={<Redo2 />}
            isDisabled={!editorState.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          />
        </>
      )}
      {toolbarRender && (
        <>
          <span className={dividerCls} />
          {toolbarRender(editor)}
        </>
      )}
      <input
        type="file"
        ref={imageInputRef}
        style={{ display: "none" }}
        accept={ALLOWED_IMAGE_ACCEPT}
        multiple
        onChange={handleImageFileChange}
      />
    </div>
  );
};

export const Toolbar: React.FC<IProps> = (props) => {
  const { aiOnly = false, editor, onOpenPolish } = props;

  if (aiOnly) {
    return (
      <div className="flex h-9 select-none items-center px-1 text-sm leading-tight text-foreground">
        {onOpenPolish && <AIPolishTrigger editor={editor} onOpen={onOpenPolish} />}
      </div>
    );
  }

  return <ToolbarContent editor={editor} onOpenPolish={onOpenPolish} />;
};

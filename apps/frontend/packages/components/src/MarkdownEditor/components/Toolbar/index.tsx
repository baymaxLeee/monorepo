import { type Editor, useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Code,
  Code2,
  Copy,
  CornerDownLeft,
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
  MessageSquare,
  Outdent,
  Pilcrow,
  Quote,
  Redo2,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "shared";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";

import { Button } from "../../../Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../DropdownMenu";
import { Input } from "../../../Input";
import { Menu, MenuItem, MenuItemGroup } from "../../../Menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../../Popover";
import { Textarea } from "../../../Textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../Tooltip";
import {
  AiPolishStatus,
  ALLOWED_IMAGE_ACCEPT,
  BG_COLORS,
  FONT_COLORS,
  isAllowedImageFile,
  URL_REGEX,
} from "../../constants";
import { useEditorContext } from "../../context";
import {
  type ContentType,
  RewriteActionType,
  type ToolbarMode,
} from "../../interface";
import {
  applyBlocksToSelection,
  extractSelectionToBlocks,
  extractTextFromPartialJson,
  getFullUrl,
  parseSSEStream,
  type SelectionSnapshot,
} from "../../utils";
import { TableSelector } from "../TableSelector";

interface IProps {
  editor: Editor;
  aiEnable?: boolean;
  commentEnable?: boolean;
  onOpenPolish?: () => void;
}

const colorNormalizer =
  typeof document !== "undefined" ? document.createElement("div") : null;

// ============================================================
// 工具栏内联 utility class（高保真还原自原 Toolbar/index.less）
// ============================================================
/**
 * 普通图标按钮（B/I/U/S/Code/Link 等）。
 * active 仅改文字色（高保真还原原 less `color: rgb(var(--primary-6))`），
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
      : "cursor-pointer hover:bg-accent data-[state=open]:bg-accent data-[state=open]:[&>svg.icon-down]:rotate-180",
    isActive && !isDisabled && "text-blue-600",
  );
}

/** 工具栏内的竖向分隔线 */
const dividerCls = "mx-1 h-4 w-px shrink-0 bg-border";

export function getActiveNodeType(
  editor: Editor,
  toolbarMode: ToolbarMode,
): string {
  if (toolbarMode === "bubble") {
    if (editor.isActive("codeBlock")) return "codeBlock";
    if (editor.isActive("orderedList")) return "orderedList";
    if (editor.isActive("taskList")) return "taskList";
    if (editor.isActive("bulletList")) return "bulletList";
    if (editor.isActive("blockquote")) return "blockquote";
  }
  for (let i = 1; i <= 6; i++) {
    if (editor.isActive("heading", { level: i })) return `h${i}`;
  }
  return "paragraph";
}

export function getActiveTextAlign(editor: Editor): string {
  if (editor.isActive({ textAlign: "center" })) return "center";
  if (editor.isActive({ textAlign: "right" })) return "right";
  return "left";
}

export function computeCanChangeType(
  editor: Editor,
  contentType: ContentType,
): boolean {
  const { $from, $to } = editor.state.selection;
  if (contentType === "markdown") {
    for (let d = $from.depth; d >= 0; d--) {
      const name = $from.node(d).type.name;
      if (name === "tableCell" || name === "tableHeader") return false;
    }
  }
  if ($from.parent === $to.parent) return true;
  let allParagraph = true;
  editor.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
    if (!allParagraph) return false;
    if (node.isTextblock) {
      const $pos = editor.state.doc.resolve(pos);
      const topNode = $pos.depth >= 1 ? $pos.node(1) : node;
      if (topNode.type.name !== "paragraph") allParagraph = false;
    }
    return true;
  });
  return allParagraph;
}

export function computeIsTableContext(editor: Editor): boolean {
  const { $from } = editor.state.selection;

  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name;
    if (
      name === "table" ||
      name === "tableRow" ||
      name === "tableCell" ||
      name === "tableHeader"
    ) {
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
  if (!colorNormalizer) return color;
  colorNormalizer.style.color = color;
  return colorNormalizer.style.color;
};

export const ColorPickerContent = ({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) => {
  const isColorActive = (color: string) => {
    const currentColor = editor.getAttributes("textStyle").color;
    if (color === "inherit") return !currentColor;
    if (!currentColor) return false;
    return normalizeColor(currentColor) === normalizeColor(color);
  };

  const isBgActive = (color: string) => {
    const currentBg = editor.getAttributes("highlight").color;
    if (color === "transparent") return !currentBg;
    if (!currentBg) return false;
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
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex size-6 cursor-pointer items-center justify-center rounded border border-border transition-all",
                    isColorActive(item.color)
                      ? "border-blue-600"
                      : "hover:border-blue-600/60",
                  )}
                  onClick={() => handleSetColor(item.color)}
                >
                  <span
                    className="text-sm font-medium leading-none"
                    style={{ color: item.color }}
                  >
                    A
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{item.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 px-1 text-xs text-muted-foreground">背景颜色</div>
        <div className="grid grid-cols-8 gap-1.5 px-1">
          {BG_COLORS.map((item) => (
            <Tooltip key={item.color}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "group/bg relative flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded border border-transparent transition-all",
                    isBgActive(item.color)
                      ? "scale-[0.85] border-blue-600"
                      : "hover:scale-[0.85] hover:border-blue-600/60",
                  )}
                  onClick={() => handleSetBg(item.color)}
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
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{item.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className="px-1">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() =>
            editor.chain().focus().unsetColor().unsetHighlight().run()
          }
        >
          恢复默认
        </Button>
      </div>
    </div>
  );
};

const AlignDropdownItems = ({
  editor,
  textAlign,
}: {
  editor: Editor;
  textAlign: string;
}) => {
  const handle = (key: "left" | "center" | "right" | "outdent" | "indent") => {
    switch (key) {
      case "left":
      case "center":
      case "right":
        editor.chain().focus().setTextAlign(key).run();
        break;
      case "outdent":
        editor.chain().focus().outdent().run();
        break;
      case "indent":
        editor.chain().focus().indent().run();
        break;
    }
  };

  // active 仅用蓝色文字（对齐原 less `color: rgb(var(--primary-6))`），不动背景；
  // focus 也强制保持蓝色文字，避免被 DropdownMenuItem 默认的 focus:text-secondary-foreground 覆盖。
  const itemCls = (active: boolean) =>
    cn(
      "gap-2 [&>svg]:size-4",
      active && "font-medium text-blue-600 focus:text-blue-600",
    );

  return (
    <>
      <DropdownMenuItem
        onClick={() => handle("left")}
        className={itemCls(textAlign === "left")}
      >
        <AlignLeft />
        左对齐
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => handle("center")}
        className={itemCls(textAlign === "center")}
      >
        <AlignCenter />
        居中对齐
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => handle("right")}
        className={itemCls(textAlign === "right")}
      >
        <AlignRight />
        右对齐
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => handle("outdent")}
        className="gap-2 [&>svg]:size-4"
      >
        <Outdent />
        减少缩进
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => handle("indent")}
        className="gap-2 [&>svg]:size-4"
      >
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
  const handle = (key: string) => {
    let chain = editor.chain().focus();

    // 先彻底清理现有的块类型，确保互斥
    if (editor.isActive("bulletList")) chain = chain.toggleBulletList();
    if (editor.isActive("orderedList")) chain = chain.toggleOrderedList();
    if (editor.isActive("taskList")) chain = chain.toggleTaskList();
    if (editor.isActive("blockquote")) chain = chain.toggleBlockquote();
    if (editor.isActive("codeBlock")) chain = chain.toggleCodeBlock();
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
            chain
              .toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
              .run();
          }
        }
    }
  };

  const itemCls = (key: string) =>
    cn(
      "gap-2 [&>svg]:size-4",
      activeNodeType === key && "font-medium text-blue-600 focus:text-blue-600",
    );

  return (
    <>
      <DropdownMenuItem
        onClick={() => handle("paragraph")}
        className={itemCls("paragraph")}
      >
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
            <DropdownMenuItem
              onClick={() => handle("h4")}
              className={itemCls("h4")}
            >
              <Heading4 />
              四级标题
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handle("h5")}
              className={itemCls("h5")}
            >
              <Heading5 />
              五级标题
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handle("h6")}
              className={itemCls("h6")}
            >
              <Heading6 />
              六级标题
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : (
        <>
          <DropdownMenuItem
            onClick={() => handle("h4")}
            className={itemCls("h4")}
          >
            <Heading4 />
            四级标题
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handle("h5")}
            className={itemCls("h5")}
          >
            <Heading5 />
            五级标题
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handle("h6")}
            className={itemCls("h6")}
          >
            <Heading6 />
            六级标题
          </DropdownMenuItem>
        </>
      )}
      {toolbarMode === "bubble" && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => handle("bulletList")}
            className={itemCls("bulletList")}
          >
            <List />
            无序列表
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handle("orderedList")}
            className={itemCls("orderedList")}
          >
            <ListOrdered />
            有序列表
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handle("taskList")}
            className={itemCls("taskList")}
          >
            <ListChecks />
            任务列表
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => handle("blockquote")}
            className={itemCls("blockquote")}
          >
            <Quote />
            引用
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => handle("codeBlock")}
            className={itemCls("codeBlock")}
          >
            <Code2 />
            代码块
          </DropdownMenuItem>
        </>
      )}
    </>
  );
};

export const AIPolishContent = ({
  editor,
  onClose,
  statusRef,
}: {
  editor: Editor;
  onClose: () => void;
  statusRef?: React.MutableRefObject<AiPolishStatus>;
}) => {
  const inputRef = useRef<HTMLDivElement>(null);
  const [triggerVisible, setTriggerVisible] = useState(false);
  const [newTexts, setNewTexts] = useState<string[]>([]);
  const [status, _setStatus] = useState<AiPolishStatus>(AiPolishStatus.Pending);
  const setStatus = (s: AiPolishStatus) => {
    _setStatus(s);
    if (statusRef) statusRef.current = s;
  };
  const snapshotRef = useRef<SelectionSnapshot>();
  const promptRef = useRef<string>("");
  const actionTypeRef = useRef<RewriteActionType | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);
  const { setMaskVisible, onAiPolish } = useEditorContext(
    ({ onAiPolish, setMaskVisible }) => ({
      onAiPolish,
      setMaskVisible,
    }),
  );

  const getInputValue = () => {
    return inputRef.current?.innerText || "";
  };

  const setInputValue = (val: string) => {
    if (inputRef.current) {
      inputRef.current.innerText = val;
      inputRef.current.dataset.empty = val ? "false" : "true";
    }
  };

  useEffect(() => {
    setMaskVisible?.(true);
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setTriggerVisible(false);
      setMaskVisible?.(false);
    };
    // 故意 mount-once：只在弹层装载/卸载时切换 mask；
    // setMaskVisible 引用变化不应触发清理（会让 UI 闪烁）
  }, []);

  const handlePolish = async () => {
    if (
      actionTypeRef.current === RewriteActionType.ChatInDoc &&
      !promptRef.current
    ) {
      toast.warning("请输入指令");
      return;
    }
    try {
      const snapshot = extractSelectionToBlocks(editor);
      snapshotRef.current = snapshot;
      if (snapshot.blocks.length === 0) {
        toast.warning("未选中文本");
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setStatus(AiPolishStatus.Loading);

      const content = snapshot.blocks.map((item) => ({
        content: item.text,
        type: item.type,
      }));

      const stream = await onAiPolish?.(
        {
          action: actionTypeRef.current!,
          command: promptRef.current,
          selected_content: content,
        },
        controller.signal,
      );

      if (!stream) {
        throw new TypeError("AI 润色未返回有效流");
      }

      let accumulated = "";
      for await (const token of parseSSEStream(stream)) {
        if (controller.signal.aborted) break;
        accumulated += token;
        setInputValue(extractTextFromPartialJson(accumulated));
      }

      if (controller.signal.aborted) return;

      let texts: string[];
      try {
        const parsed: { content: string; type: string }[] =
          JSON.parse(accumulated);
        texts = parsed.map((item) => item.content);
      } catch {
        texts = [accumulated];
      }

      setInputValue(texts.join("\n"));
      setNewTexts(texts);
      setStatus(AiPolishStatus.Ready);
    } catch (e) {
      const error = e as { name?: string; message?: string };
      if (error.name === "AbortError") return;
      toast.warning(error.message || "AI 润色失败，请稍后重试");
      handleReset();
    }
  };

  const handleReplace = () => {
    if (!snapshotRef.current) return;
    applyBlocksToSelection(editor, snapshotRef.current, newTexts);
    toast.success("AI 润色成功");
    handleReset();
  };

  const handleInsert = () => {
    if (!snapshotRef.current) return;
    const text = getInputValue();
    if (!text) return;

    editor.chain().insertContentAt(snapshotRef.current.range.to, text).run();
    toast.success("AI 插入成功");
    handleReset();
  };

  const handleMenuClick = (key: RewriteActionType) => {
    actionTypeRef.current = key;
    handlePolish();
    setTriggerVisible(false);
  };

  const onInputFocus = () => {
    const value = getInputValue();
    if (!value) {
      setTriggerVisible(true);
    }
  };

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isEmpty =
      !target.textContent?.trim() &&
      (!target.children.length ||
        (target.children.length === 1 && target.children[0].nodeName === "BR"));

    if (isEmpty) {
      target.dataset.empty = "true";
      if (target.innerHTML === "<br>") {
        target.innerHTML = "";
      }
      setTriggerVisible(true);
    } else {
      target.dataset.empty = "false";
      setTriggerVisible(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    toast.warning("已终止");
    handleReset(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getInputValue()).then(() => {
      toast.success("复制成功");
    });
  };

  const handleRetry = () => {
    handlePolish();
  };

  const handleReset = (shouldClose: boolean = true) => {
    setInputValue("");
    setNewTexts([]);
    setStatus(AiPolishStatus.Pending);
    setTriggerVisible(true);
    if (shouldClose) {
      editor.chain().focus().setTextSelection(editor.state.selection.to).run();
      onClose();
    }
  };

  const handleSend = () => {
    actionTypeRef.current = RewriteActionType.ChatInDoc;
    promptRef.current = getInputValue();
    handlePolish();
  };

  const render = () => {
    if (status === AiPolishStatus.Pending) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="default"
              className="size-7 rounded-full"
              onClick={handleSend}
            >
              <Send className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>发送</TooltipContent>
        </Tooltip>
      );
    } else if (status === AiPolishStatus.Loading) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="default"
              className="size-7 rounded-full"
              onClick={handleStop}
            >
              <Square className="size-3 fill-current" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>终止</TooltipContent>
        </Tooltip>
      );
    }

    return (
      <>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleReplace}
            className="h-7 gap-1 border border-[#3384ff] bg-gradient-to-r from-[#3b91ff] via-[#0d5eff] to-[#c069ff] text-white shadow-[0_1px_1px_0_rgba(0,0,0,0.15)] hover:from-[#3b91ff] hover:via-[#0d5eff] hover:to-[#c069ff] hover:opacity-90"
          >
            <RefreshCw className="size-3.5" />
            替换
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleInsert}
            className="h-7 gap-1"
          >
            <CornerDownLeft className="size-3.5" />
            插入
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="size-7"
                onClick={handleCopy}
              >
                <Copy className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>复制</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="size-7"
                onClick={handleRetry}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>重试</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="size-7"
                onClick={() => handleReset(false)}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>重置</TooltipContent>
          </Tooltip>
        </div>
      </>
    );
  };

  return (
    <Popover open={triggerVisible} onOpenChange={setTriggerVisible}>
      <PopoverTrigger asChild>
        <div className="flex w-[600px] flex-wrap items-center gap-2 px-3 py-2">
          <div
            ref={inputRef}
            // 高保真还原原 Toolbar/index.less 的 ai-input：
            // 占据剩余空间、可换行、空态显示 placeholder（用 [data-empty="true"] hook）。
            className={cn(
              "max-h-60 min-h-[1em] flex-grow-[9999] overflow-y-auto break-words leading-normal outline-none",
              "[&>p]:m-0",
              "before:hidden data-[empty=true]:before:block data-[empty=true]:before:cursor-text data-[empty=true]:before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)]",
            )}
            data-empty="true"
            spellCheck
            suppressContentEditableWarning
            contentEditable={status === AiPolishStatus.Pending}
            data-placeholder="输入优化文本指令"
            tabIndex={0}
            role="textbox"
            aria-label="开始输入以编辑文本"
            inputMode="text"
            onFocus={onInputFocus}
            onInput={handleInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="flex max-w-full flex-grow justify-between gap-2">
            {render()}
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-auto rounded-lg border bg-popover p-1 shadow-md"
        // 阻止 Popover 抢焦点，让 contentEditable 能正常输入
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Menu inline>
          <MenuItemGroup label="快捷指令">
            <MenuItem
              icon={<Wand2 />}
              onClick={() => handleMenuClick(RewriteActionType.Polish)}
            >
              润色
            </MenuItem>
            <MenuItem
              icon={<ChevronsUpDown />}
              onClick={() => handleMenuClick(RewriteActionType.Expansion)}
            >
              扩写
            </MenuItem>
            <MenuItem
              icon={<ChevronsDownUp />}
              onClick={() => handleMenuClick(RewriteActionType.Abbreviation)}
            >
              缩写
            </MenuItem>
          </MenuItemGroup>
        </Menu>
      </PopoverContent>
    </Popover>
  );
};
interface ToolbarContentProps {
  editor: Editor;
  aiEnable?: boolean;
  commentEnable?: boolean;
  onOpenPolish?: () => void;
}

const ToolbarContent = ({
  editor,
  aiEnable,
  commentEnable,
  onOpenPolish,
}: ToolbarContentProps) => {
  const { contentType, toolbarMode, toolbarRender, onUpload } =
    useEditorContext((ctx) => ({
      contentType: ctx.contentType,
      toolbarMode: ctx.toolbarMode,
      toolbarRender: ctx.toolbarRender,
      onUpload: ctx.onUpload,
    }));
  const [linkUrl, setLinkUrl] = useState("");
  const [linkVisible, setLinkVisible] = useState(false);
  const [comment, setComment] = useState("");
  const [commentVisible, setCommentVisible] = useState(false);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

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
        canColor: !!(
          can.setColor?.("#000") && can.setHighlight?.({ color: "#000" })
        ),
        canAddComment: !e.state.selection.empty,
        selectionTextLength: e.state.selection.empty
          ? 0
          : e.state.doc.textBetween(
              e.state.selection.from,
              e.state.selection.to,
              " ",
            ).length,
        currentColor:
          (e.getAttributes("textStyle").color as string | undefined) ?? null,
        currentBg:
          (e.getAttributes("highlight").color as string | undefined) ?? null,
        canChangeType: computeCanChangeType(e, contentType),
      };
    },
    equalityFn: (prev, next) => {
      if (!prev || !next) return prev === next;
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
        prev.canAddComment === next.canAddComment &&
        prev.selectionTextLength === next.selectionTextLength &&
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

  const handleAddComment = () => {
    if (!editorState.canAddComment) return;
    if (!comment.trim()) {
      toast.warning("请输入评论内容");
      return;
    }
    editor.chain().focus().addComment(uuidv4()).run();
    setCommentVisible(false);
    setComment("");
  };

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
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={!!isActive}
          aria-disabled={!!isDisabled}
          className={btnCls({ isActive, isDisabled })}
          onClick={() => {
            if (isDisabled) return;
            onClick();
          }}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex h-9 select-none items-center px-1 text-sm leading-tight text-foreground">
      {aiEnable &&
        editorState.canColor &&
        editorState.selectionTextLength > 0 &&
        editorState.selectionTextLength <= 500 && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="AI 润色"
                  className={cn(triggerCls(), "text-blue-600 [&>svg]:size-4")}
                  onClick={() => onOpenPolish?.()}
                >
                  <Sparkles />
                  <span className="text-xs">AI 润色</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">AI 润色</TooltipContent>
            </Tooltip>
            <span className={dividerCls} />
          </>
        )}

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

      {/* 节点类型（hover 触发） */}
      <DropdownMenu trigger="hover">
        <DropdownMenuTrigger
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
        <DropdownMenuContent align="start" className="min-w-32">
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
          <DropdownMenu trigger="hover">
            <DropdownMenuTrigger
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
            <DropdownMenuContent align="start" className="min-w-28">
              <AlignDropdownItems
                editor={editor}
                textAlign={editorState.textAlign}
              />
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

      {/* 链接 */}
      <Popover
        open={linkVisible}
        onOpenChange={(v) => {
          setLinkVisible(v);
          if (!v) setLinkUrl("");
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger
              type="button"
              disabled={!editorState.canLink}
              aria-label="链接"
              className={btnCls({
                isActive: editorState.isLink,
                isDisabled: !editorState.canLink,
              })}
            >
              <Link2 />
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">链接</TooltipContent>
        </Tooltip>
        <PopoverContent
          align="start"
          className="w-64 p-3"
          onOpenAutoFocus={(e) => {
            // 让 Input 接管首焦
            e.preventDefault();
          }}
        >
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

      {/* 颜色（仅非 markdown 模式，hover 触发） */}
      {contentType !== "markdown" && (
        <Popover
          trigger="hover"
          open={colorPickerVisible}
          onOpenChange={setColorPickerVisible}
        >
          <PopoverTrigger
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
          <PopoverContent align="start" className="w-auto p-3">
            <ColorPickerContent
              editor={editor}
              onClose={() => setColorPickerVisible(false)}
            />
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
          <IconBtn
            label="代码块"
            icon={<Code2 />}
            isActive={editorState.isCodeBlock}
            isDisabled={!editorState.canChangeType}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          />
          {/* 表格：插入用 hover popover，已存在则点击删除 */}
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
                <TooltipTrigger asChild>
                  <PopoverTrigger
                    type="button"
                    aria-label="插入表格"
                    className={btnCls()}
                  >
                    <TableIcon />
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">插入表格</TooltipContent>
              </Tooltip>
              <PopoverContent align="start" className="w-auto p-2">
                <TableSelector
                  onSelect={(rows, cols) => {
                    editor
                      .chain()
                      .focus()
                      .insertTable({ rows, cols, withHeaderRow: true })
                      .run();
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

      {commentEnable && (
        <>
          <span className={dividerCls} />
          <Popover
            open={commentVisible}
            onOpenChange={(v) => {
              if (!editorState.canAddComment && v) return;
              setCommentVisible(v);
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger
                  type="button"
                  disabled={!editorState.canAddComment}
                  aria-label="评论"
                  className={btnCls({
                    isDisabled: !editorState.canAddComment,
                  })}
                >
                  <MessageSquare />
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">评论</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-64 p-3">
              <Textarea
                placeholder="输入评论"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="mb-2 min-h-20"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCommentVisible(false)}
                >
                  取消
                </Button>
                <Button size="sm" onClick={handleAddComment}>
                  确认
                </Button>
              </div>
            </PopoverContent>
          </Popover>
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
  const { editor, aiEnable, commentEnable, onOpenPolish } = props;

  return (
    <ToolbarContent
      editor={editor}
      aiEnable={aiEnable}
      commentEnable={commentEnable}
      onOpenPolish={onOpenPolish}
    />
  );
};

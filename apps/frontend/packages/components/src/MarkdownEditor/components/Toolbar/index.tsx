import {
  Button,
  Input,
  Menu,
  Message,
  Tooltip,
  Trigger,
} from "../../../compat/legacy-ui";
import {
  IconRecordStop,
  IconSend,
  IconSync,
  IconToLeft,
} from "../../../compat/legacy-icons";
import {
  IconAbbreviation1,
  IconBlod1,
  IconChecklist1,
  IconCodeBrackets1,
  IconCopy,
  IconDown,
  IconExpand1,
  IconH11,
  IconH21,
  IconH31,
  IconH41,
  IconH51,
  IconH61,
  IconHn1,
  IconHorizontalAlignment1,
  IconImage1,
  IconIndentLeft1,
  IconIndentRight1,
  IconInderline1,
  IconInlineCode1,
  IconItalic1,
  IconLeftAlignment1,
  IconLink1,
  IconMessage,
  IconOrderedList1,
  IconQuoted1,
  IconRedo1,
  IconRefresh,
  IconRevise1,
  IconRightAlignment1,
  IconStrikethrough1,
  IconTable1,
  IconText1,
  IconText2,
  IconUndo1,
  IconUnorderedList1,
} from "../../../compat/legacy-icons";
import { Editor, useEditorState } from "@tiptap/react";
import { cn } from "shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { slotClassNameFactory } from "../../../compat/className";
import {
  AiPolishStatus,
  ALLOWED_IMAGE_ACCEPT,
  BG_COLORS,
  FONT_COLORS,
  isAllowedImageFile,
  URL_REGEX,
} from "../../constants";
import { useEditorContext } from "../../context";
import { ContentType, RewriteActionType, ToolbarMode } from "../../interface";
import {
  applyBlocksToSelection,
  extractSelectionToBlocks,
  extractTextFromPartialJson,
  getFullUrl,
  parseSSEStream,
  SelectionSnapshot,
} from "../../utils";
import { TableSelector } from "../TableSelector";

interface IProps {
  editor: Editor;
  aiEnable?: boolean;
  commentEnable?: boolean;
  onOpenPolish?: () => void;
}

const cssPrefix = slotClassNameFactory("markdown-editor-toolbar");
const colorNormalizer =
  typeof document !== "undefined" ? document.createElement("div") : null;

const SubMenu = Menu.SubMenu;
const MenuItemGroup = Menu.ItemGroup;
const MenuItem = (props: React.ComponentProps<typeof Menu.Item>) => {
  return (
    <Menu.Item {...props} className={cssPrefix`menu-item`}>
      {props.children}
    </Menu.Item>
  );
};

const getButtonClass = (isActive = false, isDisabled = false) => {
  return cn(cssPrefix`btn`, {
    [cssPrefix`active`]: isActive,
    [cssPrefix`disabled`]: isDisabled,
  });
};

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
      return <IconCodeBrackets1 />;
    case "orderedList":
      return <IconOrderedList1 />;
    case "taskList":
      return <IconChecklist1 />;
    case "bulletList":
      return <IconUnorderedList1 />;
    case "h1":
      return <IconH11 />;
    case "h2":
      return <IconH21 />;
    case "h3":
      return <IconH31 />;
    case "h4":
      return <IconH41 />;
    case "h5":
      return <IconH51 />;
    case "h6":
      return <IconH61 />;
    case "blockquote":
      return <IconQuoted1 />;
    default:
      return <IconText2 />;
  }
}

export function getAlignIcon(align: string) {
  switch (align) {
    case "center":
      return <IconHorizontalAlignment1 />;
    case "right":
      return <IconRightAlignment1 />;
    default:
      return <IconLeftAlignment1 />;
  }
}

export const normalizeColor = (color: string) => {
  if (!colorNormalizer) return color;
  colorNormalizer.style.color = color;
  return colorNormalizer.style.color;
};

export const ColorPickerContent = ({
  editor,
  setColorPickerVisible,
}: {
  editor: Editor;
  setColorPickerVisible: (visible: boolean) => void;
}) => {
  const isColorActive = (color: string) => {
    const currentColor = editor.getAttributes("textStyle").color;
    if (color === "inherit") {
      return !currentColor;
    }

    if (!currentColor) return false;

    return normalizeColor(currentColor) === normalizeColor(color);
  };

  const isBgActive = (color: string) => {
    const currentBg = editor.getAttributes("highlight").color;
    if (color === "transparent") {
      return !currentBg;
    }

    if (!currentBg) return false;

    return normalizeColor(currentBg) === normalizeColor(color);
  };

  const handleSetColor = (color: string) => {
    if (color === "inherit") {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().setColor(color).run();
    }
    setColorPickerVisible(false);
  };

  const handleSetBg = (color: string) => {
    if (color === "transparent") {
      editor.chain().focus().unsetHighlight().run();
    } else {
      editor.chain().focus().setHighlight({ color }).run();
    }
    setColorPickerVisible(false);
  };

  return (
    <div className={cssPrefix`popup-color`}>
      <div>
        <div className={cssPrefix`color-title`}>字体颜色</div>
        <div className={cssPrefix`color-grid`}>
          {FONT_COLORS.map((item) => (
            <Tooltip key={item.color} content={item.label} mini>
              <div
                className={cn(
                  cssPrefix`color-btn`,
                  isColorActive(item.color) ? cssPrefix`active` : "",
                )}
                onClick={() => handleSetColor(item.color)}
              >
                <span
                  className={cssPrefix`color-span`}
                  style={{ color: item.color }}
                >
                  A
                </span>
              </div>
            </Tooltip>
          ))}
        </div>
      </div>

      <div>
        <div className={cssPrefix`color-title`}>背景颜色</div>
        <div className={cssPrefix`color-grid`}>
          {BG_COLORS.map((item) => (
            <Tooltip key={item.color} content={item.label} mini>
              <div
                className={cn(
                  cssPrefix`bg-btn`,
                  isBgActive(item.color) ? cssPrefix`active` : "",
                )}
                onClick={() => handleSetBg(item.color)}
              >
                <div
                  className={cssPrefix`bg-preview`}
                  style={{ backgroundColor: item.color }}
                >
                  {item.color === "transparent" && (
                    <div className={cssPrefix`bg-transparent-inner`}>
                      <div className={cssPrefix`bg-transparent-line`} />
                    </div>
                  )}
                </div>
              </div>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className={cssPrefix`restore-wrapper`}>
        <Button
          size="mini"
          className={cssPrefix`restore-btn`}
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

const AlignContent = ({
  editor,
  textAlign,
  setTextAlignVisible,
}: {
  editor: Editor;
  textAlign: string;
  setTextAlignVisible: (visible: boolean) => void;
}) => {
  const selectedKeys = [textAlign];

  const handleMenuClick = (key: string) => {
    switch (key) {
      case "left":
        editor.chain().focus().setTextAlign("left").run();
        break;
      case "center":
        editor.chain().focus().setTextAlign("center").run();
        break;
      case "right":
        editor.chain().focus().setTextAlign("right").run();
        break;
      case "outdent":
        editor.chain().focus().outdent().run();
        break;
      case "indent":
        editor.chain().focus().indent().run();
        break;
    }
    setTextAlignVisible(false);
  };

  return (
    <div className={cssPrefix`align-popup`}>
      <Menu selectedKeys={selectedKeys} onClickMenuItem={handleMenuClick}>
        <MenuItem key="left">
          <IconLeftAlignment1 style={{ marginRight: 8 }} />
          左对齐
        </MenuItem>
        <MenuItem key="center">
          <IconHorizontalAlignment1 style={{ marginRight: 8 }} />
          居中对齐
        </MenuItem>
        <MenuItem key="right">
          <IconRightAlignment1 style={{ marginRight: 8 }} />
          右对齐
        </MenuItem>

        <div className={cssPrefix`menu-divider`} />

        <MenuItem key="outdent">
          <IconIndentLeft1 />
          减少缩进
        </MenuItem>
        <MenuItem key="indent">
          <IconIndentRight1 />
          增加缩进
        </MenuItem>
      </Menu>
    </div>
  );
};

const NodeTypeContent = ({
  editor,
  activeNodeType,
  toolbarMode,
  setNodeTypeVisible,
}: {
  editor: Editor;
  activeNodeType: string;
  toolbarMode: ToolbarMode;
  setNodeTypeVisible: (visible: boolean) => void;
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState("400px");

  useEffect(() => {
    const calculateHeight = () => {
      if (dropdownRef.current) {
        const rect = dropdownRef.current.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        const bottomSpace = windowHeight - rect.top;
        const calculated = Math.min(400, Math.max(100, bottomSpace - 20));
        setMaxHeight(`${calculated}px`);
      }
    };

    calculateHeight();
    window.addEventListener("resize", calculateHeight);
    return () => window.removeEventListener("resize", calculateHeight);
  }, []);

  const selectedKeys = activeNodeType ? [activeNodeType] : [];

  const handleMenuClick = (key: string) => {
    let chain = editor.chain().focus();

    // 1. 先彻底清理现有的块类型，确保互斥
    if (editor.isActive("bulletList")) chain = chain.toggleBulletList();
    if (editor.isActive("orderedList")) chain = chain.toggleOrderedList();
    if (editor.isActive("taskList")) chain = chain.toggleTaskList();
    if (editor.isActive("blockquote")) chain = chain.toggleBlockquote();
    if (editor.isActive("codeBlock")) chain = chain.toggleCodeBlock();

    // 如果是标题，先转成正文再处理
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive("heading", { level: i })) {
        chain = chain.setParagraph();
        break;
      }
    }

    // 2. 应用新的类型
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
          if (!isNaN(level)) {
            chain
              .toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
              .run();
          }
        }
    }
    setNodeTypeVisible(false);
  };

  return (
    <div
      ref={dropdownRef}
      className={cssPrefix`node-type-popup`}
      style={{ maxHeight }}
    >
      <Menu
        mode="pop"
        selectedKeys={selectedKeys}
        onClickMenuItem={handleMenuClick}
      >
        <MenuItem key="paragraph">
          <IconText2 />
          正文
        </MenuItem>

        <div className={cssPrefix`menu-divider`} />

        <MenuItem key="h1">
          <IconH11 />
          一级标题
        </MenuItem>
        <MenuItem key="h2">
          <IconH21 />
          二级标题
        </MenuItem>
        <MenuItem key="h3">
          <IconH31 />
          三级标题
        </MenuItem>
        {toolbarMode === "bubble" ? (
          <SubMenu
            key="hn"
            className={cssPrefix`menu-item`}
            title={
              <>
                <IconHn1 />
                其他标题
              </>
            }
            triggerProps={{
              position: "rt",
              showArrow: true,
            }}
          >
            <MenuItem key="h4">
              <IconH41 />
              四级标题
            </MenuItem>
            <MenuItem key="h5">
              <IconH51 />
              五级标题
            </MenuItem>
            <MenuItem key="h6">
              <IconH61 />
              六级标题
            </MenuItem>
          </SubMenu>
        ) : (
          <>
            <MenuItem key="h4">
              <IconH41 />
              四级标题
            </MenuItem>
            <MenuItem key="h5">
              <IconH51 />
              五级标题
            </MenuItem>
            <MenuItem key="h6">
              <IconH61 />
              六级标题
            </MenuItem>
          </>
        )}

        {toolbarMode === "bubble" && (
          <>
            <div className={cssPrefix`menu-divider`} />
            <MenuItem key="bulletList">
              <IconUnorderedList1 />
              无序列表
            </MenuItem>
            <MenuItem key="orderedList">
              <IconOrderedList1 />
              有序列表
            </MenuItem>
            <MenuItem key="taskList">
              <IconChecklist1 />
              任务列表
            </MenuItem>
            <div className={cssPrefix`menu-divider`} />
            <MenuItem key="blockquote">
              <IconQuoted1 />
              引用
            </MenuItem>
            <div className={cssPrefix`menu-divider`} />
            <MenuItem key="codeBlock">
              <IconCodeBrackets1 />
              代码块
            </MenuItem>
          </>
        )}
      </Menu>
    </div>
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
      if (val) {
        inputRef.current.classList.remove(cssPrefix`empty`);
      } else {
        inputRef.current.classList.add(cssPrefix`empty`);
      }
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
  }, []);

  const handlePolish = async () => {
    if (
      actionTypeRef.current === RewriteActionType.ChatInDoc &&
      !promptRef.current
    ) {
      Message.warning("请输入指令");
      return;
    }
    try {
      const snapshot = extractSelectionToBlocks(editor);
      snapshotRef.current = snapshot;
      if (snapshot.blocks.length === 0) {
        Message.warning("未选中文本");
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
      Message.warning(error.message || "AI 润色失败，请稍后重试");
      handleReset();
    }
  };

  const handleReplace = () => {
    if (!snapshotRef.current) return;
    applyBlocksToSelection(editor, snapshotRef.current, newTexts);
    Message.success("AI 润色成功");
    handleReset();
  };

  const handleInsert = () => {
    if (!snapshotRef.current) return;
    const text = getInputValue();
    if (!text) return;

    editor.chain().insertContentAt(snapshotRef.current.range.to, text).run();
    Message.success("AI 插入成功");
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
      target.classList.add(cssPrefix`empty`);
      if (target.innerHTML === "<br>") {
        target.innerHTML = "";
      }
      setTriggerVisible(true);
    } else {
      target.classList.remove(cssPrefix`empty`);
      setTriggerVisible(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    Message.warning("已终止");
    handleReset(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getInputValue()).then(() => {
      Message.success("复制成功");
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
        <Tooltip content="发送">
          <Button
            shape="circle"
            size="mini"
            onClick={handleSend}
            icon={<IconSend />}
          />
        </Tooltip>
      );
    } else if (status === AiPolishStatus.Loading) {
      return (
        <Tooltip content="终止">
          <Button
            shape="circle"
            size="mini"
            onClick={handleStop}
            icon={<IconRecordStop />}
          />
        </Tooltip>
      );
    }

    return (
      <>
        <div className={cssPrefix`apply-btn-group`}>
          <Button
            size="mini"
            className={cssPrefix`primary-btn`}
            onClick={handleReplace}
            icon={<IconRefresh />}
          >
            替换
          </Button>
          <Button size="mini" onClick={handleInsert} icon={<IconToLeft />}>
            插入
          </Button>
        </div>
        <div className={cssPrefix`apply-btn-group`}>
          <Tooltip content="复制">
            <Button size="mini" onClick={handleCopy} icon={<IconCopy />} />
          </Tooltip>
          <Tooltip content="重试">
            <Button size="mini" onClick={handleRetry} icon={<IconRefresh />} />
          </Tooltip>
          <Tooltip content="重置">
            <Button
              size="mini"
              onClick={() => handleReset(false)}
              icon={<IconSync />}
            />
          </Tooltip>
        </div>
      </>
    );
  };

  return (
    <Trigger
      popupVisible={triggerVisible}
      position="bl"
      popup={() => (
        <Menu
          className={cssPrefix`ai-polish-popup`}
          mode="pop"
          selectable={false}
          onClickMenuItem={handleMenuClick}
        >
          <MenuItemGroup title="快捷指令">
            <MenuItem key={RewriteActionType.Polish}>
              <IconRevise1 />
              润色
            </MenuItem>
            <MenuItem key={RewriteActionType.Expansion}>
              <IconExpand1 />
              扩写
            </MenuItem>
            <MenuItem key={RewriteActionType.Abbreviation}>
              <IconAbbreviation1 />
              缩写
            </MenuItem>
          </MenuItemGroup>
        </Menu>
      )}
    >
      <div className={cssPrefix`ai-polish-content`}>
        <div
          ref={inputRef}
          className={cn(cssPrefix`ai-input`, cssPrefix`empty`)}
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
        <div className={cssPrefix`ai-right-box`}>{render()}</div>
      </div>
    </Trigger>
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
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [comment, setComment] = useState("");
  const [commentVisible, setCommentVisible] = useState(false);
  const [nodeTypeVisible, setNodeTypeVisible] = useState(false);
  const [textAlignVisible, setTextAlignVisible] = useState(false);
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

  const disabled = useMemo(() => {
    return !URL_REGEX.test(linkUrl);
  }, [linkUrl]);

  const handleAddComment = () => {
    if (!editorState.canAddComment) {
      return;
    }

    if (!comment.trim()) {
      Message.warning("请输入评论内容");
      return;
    }

    editor.chain().focus().addComment(uuidv4()).run();
    setCommentVisible(false);
    setComment("");
  };

  return (
    <div className={cssPrefix`content`}>
      {aiEnable &&
        editorState.canColor &&
        editorState.selectionTextLength > 0 &&
        editorState.selectionTextLength <= 500 && (
          <>
            <Tooltip content="AI 润色" mini>
              <div
                className={cssPrefix`trigger-btn`}
                style={{ color: "rgb(var(--primary-6))" }}
                onClick={() => onOpenPolish?.()}
              >
                <IconRevise1 />
                <span>AI 润色</span>
              </div>
            </Tooltip>
            <div className={cssPrefix`divider`} />
          </>
        )}

      {toolbarMode === "fixed" && (
        <>
          <Tooltip content="撤销" mini>
            <div
              className={getButtonClass(false, !editorState.canUndo)}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <IconUndo1 />
            </div>
          </Tooltip>
          <Tooltip content="重做" mini>
            <div
              className={getButtonClass(false, !editorState.canRedo)}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <IconRedo1 />
            </div>
          </Tooltip>
          <div className={cssPrefix`divider`} />
        </>
      )}

      <Trigger
        popup={() => (
          <NodeTypeContent
            editor={editor}
            activeNodeType={editorState.activeNodeType}
            toolbarMode={toolbarMode}
            setNodeTypeVisible={setNodeTypeVisible}
          />
        )}
        position="bottom"
        disabled={!editorState.canChangeType}
        popupVisible={nodeTypeVisible}
        onVisibleChange={setNodeTypeVisible}
      >
        <div
          className={cn(cssPrefix`trigger-btn`, {
            [cssPrefix`disabled`]: !editorState.canChangeType,
          })}
        >
          {getNodeTypeIcon(editorState.activeNodeType)}
          <IconDown className={cssPrefix`icon-down`} />
        </div>
      </Trigger>

      {contentType !== "markdown" && (
        <>
          <div className={cssPrefix`divider`} />
          <Trigger
            popup={() => (
              <AlignContent
                editor={editor}
                textAlign={editorState.textAlign}
                setTextAlignVisible={setTextAlignVisible}
              />
            )}
            disabled={!editorState.canAlign}
            position="bottom"
            popupVisible={textAlignVisible}
            onVisibleChange={setTextAlignVisible}
          >
            <div
              className={cn(cssPrefix`trigger-btn`, {
                [cssPrefix`disabled`]: !editorState.canAlign,
              })}
            >
              {getAlignIcon(editorState.textAlign)}
              <IconDown className={cssPrefix`icon-down`} />
            </div>
          </Trigger>
        </>
      )}

      <div className={cssPrefix`divider`} />

      <Tooltip content="加粗" mini>
        <div
          className={getButtonClass(editorState.isBold, !editorState.canBold)}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <IconBlod1 />
        </div>
      </Tooltip>
      <Tooltip content="斜体" mini>
        <div
          className={getButtonClass(
            editorState.isItalic,
            !editorState.canItalic,
          )}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <IconItalic1 />
        </div>
      </Tooltip>
      <Tooltip content="下划线" mini>
        <div
          className={getButtonClass(
            editorState.isUnderline,
            !editorState.canUnderline,
          )}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <IconInderline1 />
        </div>
      </Tooltip>
      <Tooltip content="删除线" mini>
        <div
          className={getButtonClass(
            editorState.isStrike,
            !editorState.canStrike,
          )}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <IconStrikethrough1 />
        </div>
      </Tooltip>
      <Tooltip content="代码" mini>
        <div
          className={getButtonClass(editorState.isCode, !editorState.canCode)}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <IconInlineCode1 />
        </div>
      </Tooltip>
      <Tooltip content="链接" mini>
        <Trigger
          popupVisible={linkVisible}
          onVisibleChange={(v) => {
            setLinkVisible(v);
            if (!v) setLinkUrl("");
          }}
          trigger="click"
          position="bottom"
          popup={() => (
            <div className={cssPrefix`input-popup`}>
              <Input
                autoFocus
                placeholder="输入链接地址..."
                value={linkUrl}
                onChange={setLinkUrl}
                onPressEnter={setLink}
                className={cssPrefix`input-mb`}
              />
              <div className={cssPrefix`input-actions`}>
                <Button
                  size="mini"
                  onClick={() => {
                    setLinkVisible(false);
                    setLinkUrl("");
                  }}
                >
                  取消
                </Button>
                <Button
                  size="mini"
                  type="primary"
                  onClick={setLink}
                  disabled={disabled}
                >
                  确认
                </Button>
              </div>
            </div>
          )}
          disabled={!editorState.canLink}
        >
          <div
            className={getButtonClass(editorState.isLink, !editorState.canLink)}
          >
            <IconLink1 />
          </div>
        </Trigger>
      </Tooltip>

      {contentType !== "markdown" && (
        <Trigger
          popup={() => (
            <ColorPickerContent
              editor={editor}
              setColorPickerVisible={setColorPickerVisible}
            />
          )}
          position="bottom"
          popupVisible={colorPickerVisible}
          onVisibleChange={setColorPickerVisible}
          disabled={!editorState.canColor}
        >
          <div
            className={cn(cssPrefix`trigger-btn`, {
              [cssPrefix`disabled`]: !editorState.canColor,
            })}
          >
            <IconText1
              style={{
                color: editorState.currentColor || FONT_COLORS[0].color,
                backgroundColor: editorState.currentBg || BG_COLORS[0].color,
              }}
            />
            <IconDown className={cssPrefix`icon-down`} />
          </div>
        </Trigger>
      )}

      <div className={cssPrefix`divider`} />

      {toolbarMode === "fixed" && (
        <>
          <Tooltip content="无序列表" mini>
            <div
              className={getButtonClass(
                editorState.isBulletList,
                !editorState.canChangeType,
              )}
              onClick={() =>
                editorState.canChangeType &&
                editor.chain().focus().toggleBulletList().run()
              }
            >
              <IconUnorderedList1 />
            </div>
          </Tooltip>
          <Tooltip content="有序列表" mini>
            <div
              className={getButtonClass(
                editorState.isOrderedList,
                !editorState.canChangeType,
              )}
              onClick={() =>
                editorState.canChangeType &&
                editor.chain().focus().toggleOrderedList().run()
              }
            >
              <IconOrderedList1 />
            </div>
          </Tooltip>
          <Tooltip content="任务列表" mini>
            <div
              className={getButtonClass(
                editorState.isTaskList,
                !editorState.canChangeType,
              )}
              onClick={() =>
                editorState.canChangeType &&
                editor.chain().focus().toggleTaskList().run()
              }
            >
              <IconChecklist1 />
            </div>
          </Tooltip>
          <Tooltip content="引用" mini>
            <div
              className={getButtonClass(
                editorState.isBlockquote,
                !editorState.canChangeType,
              )}
              onClick={() =>
                editorState.canChangeType &&
                editor.chain().focus().toggleBlockquote().run()
              }
            >
              <IconQuoted1 />
            </div>
          </Tooltip>
          <Tooltip content="代码块" mini>
            <div
              className={getButtonClass(
                editorState.isCodeBlock,
                !editorState.canChangeType,
              )}
              onClick={() =>
                editorState.canChangeType &&
                editor.chain().focus().toggleCodeBlock().run()
              }
            >
              <IconCodeBrackets1 />
            </div>
          </Tooltip>
          <Tooltip content={editorState.isTable ? "删除表格" : "插入表格"} mini>
            {editorState.isTable ? (
              <div
                className={getButtonClass(true, false)}
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                <IconTable1 />
              </div>
            ) : (
              <Trigger
                popup={() => (
                  <TableSelector
                    onSelect={(rows, cols) => {
                      editor
                        .chain()
                        .focus()
                        .insertTable({ rows, cols, withHeaderRow: true })
                        .run();
                    }}
                  />
                )}
                popupAlign={{ bottom: 10 }}
                position="bottom"
                trigger="hover"
              >
                <div className={getButtonClass(false, false)}>
                  <IconTable1 />
                </div>
              </Trigger>
            )}
          </Tooltip>
          {onUpload && (
            <Tooltip
              content={editorState.isImage ? "删除图片" : "插入图片"}
              mini
            >
              <div
                className={getButtonClass(editorState.isImage, false)}
                onClick={handleImageClick}
              >
                <IconImage1 />
              </div>
            </Tooltip>
          )}
        </>
      )}

      {toolbarMode === "bubble" && (
        <>
          <Tooltip content="撤销" mini>
            <div
              className={getButtonClass(false, !editorState.canUndo)}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <IconUndo1 />
            </div>
          </Tooltip>
          <Tooltip content="重做" mini>
            <div
              className={getButtonClass(false, !editorState.canRedo)}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <IconRedo1 />
            </div>
          </Tooltip>
        </>
      )}

      {commentEnable && (
        <>
          <div className={cssPrefix`divider`} />
          <Tooltip content="评论" mini>
            <Trigger
              popupVisible={commentVisible}
              onVisibleChange={setCommentVisible}
              trigger="click"
              position="bottom"
              disabled={!editorState.canAddComment}
              popup={() => (
                <div className={cssPrefix`input-popup`}>
                  <Input.TextArea
                    placeholder="输入评论"
                    value={comment}
                    onChange={setComment}
                    className={cssPrefix`input-mb`}
                  />
                  <div className={cssPrefix`input-actions`}>
                    <Button
                      size="mini"
                      onClick={() => setCommentVisible(false)}
                    >
                      取消
                    </Button>
                    <Button
                      size="mini"
                      type="primary"
                      onClick={handleAddComment}
                    >
                      确认
                    </Button>
                  </div>
                </div>
              )}
            >
              <div
                className={getButtonClass(false, !editorState.canAddComment)}
                onClick={() => {
                  if (!editorState.canAddComment) {
                    return;
                  }
                  setCommentVisible(true);
                }}
              >
                <IconMessage className={cssPrefix`icon`} />
              </div>
            </Trigger>
          </Tooltip>
        </>
      )}
      {toolbarRender && (
        <>
          <div className={cssPrefix`divider`} />
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

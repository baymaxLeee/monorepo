import { Button } from "@repo/design-system/shadcn/button";
import { Menu, MenuItem, MenuItemGroup } from "@repo/design-system/shadcn/menu";
import { Popover, PopoverContent } from "@repo/design-system/shadcn/popover";
import { Textarea } from "@repo/design-system/shadcn/textarea";
import { Tooltip, TooltipTrigger } from "@repo/design-system/shadcn/tooltip";
import type { Editor } from "@tiptap/react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  CornerDownLeft,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Wand2,
} from "lucide-react";
import { useRef, useState } from "react";

import { useEditorContext } from "../../context";
import { RewriteActionType } from "../../interface";
import { getMountedEditorDom } from "../../utils";
import { EditorTooltipContent } from "../EditorTooltipContent";
import { useAiPolish } from "./useAiPolish";

interface AIPolishPanelProps {
  editor: Editor;
  onClose: () => void;
}

export const AIPolishPanel = ({ editor, onClose }: AIPolishPanelProps) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { popupConfig } = useEditorContext();
  const { copy, errorMessage, hasGeneratedText, insert, replace, reset, retry, run, setText, status, stop, text } =
    useAiPolish(editor, onClose);
  const overlayContainer = popupConfig.getContainer(getMountedEditorDom(editor) ?? document.body);
  const isIdle = status === "idle";

  const runQuickAction = (action: RewriteActionType) => {
    setMenuOpen(false);
    void run({ action, command: "" });
  };

  const send = () => {
    setMenuOpen(false);
    void run({ action: RewriteActionType.ChatInDoc, command: text.trim() });
  };

  const renderRecoveryActions = () => (
    <div className="flex items-center gap-2">
      {hasGeneratedText && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                aria-label="复制"
                size="icon"
                variant="outline"
                className="size-7"
                onClick={() => void copy()}
              />
            }
          >
            <Copy className="size-3.5" />
          </TooltipTrigger>
          <EditorTooltipContent>复制</EditorTooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" aria-label="重试" size="icon" variant="outline" className="size-7" onClick={retry} />
          }
        >
          <RefreshCw className="size-3.5" />
        </TooltipTrigger>
        <EditorTooltipContent>使用原指令重试</EditorTooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              aria-label="重置"
              size="icon"
              variant="outline"
              className="size-7"
              onClick={() => {
                reset();
                setMenuOpen(true);
              }}
            />
          }
        >
          <RotateCcw className="size-3.5" />
        </TooltipTrigger>
        <EditorTooltipContent>重置</EditorTooltipContent>
      </Tooltip>
    </div>
  );

  const renderActions = () => {
    if (status === "idle") {
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                aria-label="发送"
                size="icon"
                variant="default"
                className="size-7 rounded-full"
                onClick={send}
              />
            }
          >
            <Send className="size-3.5" />
          </TooltipTrigger>
          <EditorTooltipContent>发送</EditorTooltipContent>
        </Tooltip>
      );
    }
    if (status === "loading") {
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                aria-label="终止"
                size="icon"
                variant="default"
                className="size-7 rounded-full"
                onClick={stop}
              />
            }
          >
            <Square className="size-3 fill-current" />
          </TooltipTrigger>
          <EditorTooltipContent>终止</EditorTooltipContent>
        </Tooltip>
      );
    }
    if (status === "error" || status === "cancelled") {
      return renderRecoveryActions();
    }
    return (
      <>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={replace} className="h-7 gap-1">
            <RefreshCw className="size-3.5" />
            替换
          </Button>
          <Button size="sm" variant="outline" onClick={insert} className="h-7 gap-1">
            <CornerDownLeft className="size-3.5" />
            插入到下方
          </Button>
        </div>
        {renderRecoveryActions()}
      </>
    );
  };

  return (
    <Popover open={menuOpen && isIdle} onOpenChange={(open) => isIdle && setMenuOpen(open)}>
      <div className="flex w-[min(600px,calc(100vw-1rem))] flex-wrap items-center gap-2 px-3 py-2">
        <Textarea
          ref={inputRef}
          value={text}
          readOnly={!isIdle}
          rows={1}
          aria-label="AI 润色指令和结果"
          aria-invalid={status === "error" || undefined}
          placeholder="输入优化文本指令"
          className="max-h-60 min-h-7 flex-grow-[9999] resize-none border-0 bg-transparent p-0 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          onFocus={() => isIdle && !text.trim() && setMenuOpen(true)}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            setMenuOpen(!value.trim());
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && isIdle) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="flex max-w-full flex-grow justify-between gap-2">{renderActions()}</div>
        {(status === "error" || status === "cancelled") && (
          <p role={status === "error" ? "alert" : "status"} className="basis-full text-xs text-muted-foreground">
            {status === "error" ? errorMessage : "生成已停止，可重试或重置"}
          </p>
        )}
      </div>
      <PopoverContent
        anchor={inputRef}
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-auto rounded-lg border bg-popover p-1 shadow-md"
        container={overlayContainer}
        positionerStyle={{ zIndex: popupConfig.zIndex }}
        initialFocus={false}
      >
        <Menu inline>
          <MenuItemGroup label="快捷指令">
            <MenuItem icon={<Wand2 />} onClick={() => runQuickAction(RewriteActionType.Polish)}>
              润色
            </MenuItem>
            <MenuItem icon={<ChevronsUpDown />} onClick={() => runQuickAction(RewriteActionType.Expansion)}>
              扩写
            </MenuItem>
            <MenuItem icon={<ChevronsDownUp />} onClick={() => runQuickAction(RewriteActionType.Abbreviation)}>
              缩写
            </MenuItem>
          </MenuItemGroup>
        </Menu>
      </PopoverContent>
    </Popover>
  );
};

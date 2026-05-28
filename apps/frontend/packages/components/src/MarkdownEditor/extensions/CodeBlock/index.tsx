import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewContent,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { ChevronDown, ChevronRight, Copy, WrapText } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { cn } from "shared";
import { toast } from "sonner";
import { Input } from "../../../Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../Select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../Tooltip";
import { useEditorContext } from "../../context";

const lowlight = createLowlight(common);
lowlight.registerAlias("xml", ["html"]);

const supportedLanguages: string[] = [...lowlight.listLanguages(), "html"].sort(
  (a, b) => a.localeCompare(b),
);

const ACTION_BTN_CLS =
  "flex h-6 cursor-pointer select-none items-center gap-1 rounded px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

const ACTION_BTN_ACTIVE_CLS = "bg-blue-50 text-blue-600 hover:text-blue-600";

export const CodeBlockComponent: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
}) => {
  const { language, title } = node.attrs;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isAutoWrap, setIsAutoWrap] = useState(false);
  const { contentType, editable } = useEditorContext((ctx) => ({
    contentType: ctx.contentType,
    editable: ctx.editable,
  }));
  const isMarkdown = contentType === "markdown";

  const handleCopy = () => {
    const content = node.textContent;

    navigator.clipboard.writeText(content).then(() => {
      toast.success("复制成功");
    });
  };

  const lineCount = node.textContent.split("\n").length;

  return (
    <NodeViewWrapper className="my-2 w-full">
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-lg border bg-muted transition-[border-color,box-shadow] duration-200 hover:border-blue-400/60 hover:shadow-[0_0_0_1px_rgba(59,130,246,0.1)]",
          isCollapsed ? "h-10" : "min-h-10",
        )}
      >
        {/* Header */}
        <div
          className="flex h-10 flex-shrink-0 select-none items-center justify-between border-b bg-muted px-3"
          contentEditable={false}
        >
          <div className="mr-4 flex h-6 min-w-0 flex-1 items-center">
            <button
              type="button"
              className="mr-1 flex size-6 flex-shrink-0 cursor-pointer items-center justify-center rounded transition-colors hover:bg-accent"
              onClick={() => setIsCollapsed(!isCollapsed)}
            >
              {isCollapsed ? (
                <ChevronRight className="size-3 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-3 text-muted-foreground" />
              )}
            </button>
            {!isMarkdown && (
              <Input
                placeholder="请输入代码块名称"
                value={title ?? ""}
                onChange={(e) => updateAttributes({ title: e.target.value })}
                disabled={!editable}
                className="h-6 flex-1 border-none bg-transparent px-1 py-0 text-sm shadow-none focus-visible:bg-accent focus-visible:ring-0"
              />
            )}
          </div>

          {!isCollapsed && (
            <div className="flex h-6 items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Select
                      value={language || ""}
                      onValueChange={(value) =>
                        updateAttributes({ language: value })
                      }
                      disabled={!editable}
                    >
                      <SelectTrigger className="h-6 w-[120px] border-none bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground focus:ring-0 focus-visible:ring-0">
                        <SelectValue placeholder="语言" />
                      </SelectTrigger>
                      <SelectContent>
                        {supportedLanguages.map((lang) => (
                          <SelectItem key={lang} value={lang}>
                            {lang}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </TooltipTrigger>
                <TooltipContent>切换代码语言</TooltipContent>
              </Tooltip>

              <span className="mx-2 h-3 w-px bg-border" />

              <button
                type="button"
                className={cn(
                  ACTION_BTN_CLS,
                  isAutoWrap && ACTION_BTN_ACTIVE_CLS,
                )}
                onClick={() => setIsAutoWrap(!isAutoWrap)}
              >
                <WrapText className="size-3.5" />
                <span className="text-xs">自动换行</span>
              </button>

              <span className="mx-2 h-3 w-px bg-border" />

              <button
                type="button"
                className={ACTION_BTN_CLS}
                onClick={handleCopy}
              >
                <Copy className="size-3.5" />
                <span className="text-xs">复制</span>
              </button>
            </div>
          )}
        </div>

        {/* Code Content */}
        <div
          className={cn(
            "relative flex w-full bg-background transition-all duration-200",
            isCollapsed && "hidden",
          )}
        >
          {/* Line Numbers */}
          <div
            className="flex-none select-none border-r bg-muted py-4 pr-2 text-right"
            style={{ width: 40 }}
            contentEditable={false}
          >
            {Array.from({ length: lineCount }).map((_, i) => (
              <div
                key={i}
                className="font-mono text-xs leading-[22px] text-muted-foreground"
              >
                {i + 1}
              </div>
            ))}
          </div>

          {/* Code Area */}
          <pre className="m-0 flex-1 overflow-x-auto break-all bg-background p-4 font-mono text-sm leading-[22px]">
            <code
              className="block min-w-full !border-0 !bg-transparent !p-0"
              style={{ whiteSpace: isAutoWrap ? "pre-wrap" : "pre" }}
            >
              <NodeViewContent />
            </code>
          </pre>
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export const createCodeBlockExtension = () =>
  CodeBlockLowlight.configure({
    lowlight,
    defaultLanguage: "python",
  }).extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        title: {
          default: "代码块",
          parseHTML: (element) => element.getAttribute("data-title"),
          renderHTML: (attributes) => {
            return {
              "data-title": attributes.title,
            };
          },
        },
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockComponent);
    },
  });

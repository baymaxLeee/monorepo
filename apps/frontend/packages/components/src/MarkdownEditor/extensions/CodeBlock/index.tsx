import { Input, Message, Select, Tooltip } from "../../../compat/legacy-ui";
import {
  IconCopy,
  IconDown,
  IconRight,
  IconText1,
} from "../../../compat/legacy-icons";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewContent,
  NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { cn } from "shared";
import { common, createLowlight } from "lowlight";
import React, { useState } from "react";
import { slotClassNameFactory } from "../../../compat/className";
import { useEditorContext } from "../../context";

const Option = Select.Option;
const cssPrefix = slotClassNameFactory("markdown-editor-code-block");

const lowlight = createLowlight(common);
lowlight.registerAlias("xml", ["html"]);

const supportedLanguages: string[] = [...lowlight.listLanguages(), "html"].sort(
  (a, b) => a.localeCompare(b),
);

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
      Message.success("复制成功");
    });
  };

  const lineCount = node.textContent.split("\n").length;

  return (
    <NodeViewWrapper className={cssPrefix`wrapper`}>
      <div
        className={cn(
          cssPrefix`container`,
          isCollapsed ? cssPrefix`collapsed` : "",
        )}
      >
        {/* Header */}
        <div className={cssPrefix`header`} contentEditable={false}>
          <div className={cssPrefix`header-left`}>
            <div
              className={cssPrefix`collapse-btn`}
              onClick={() => setIsCollapsed(!isCollapsed)}
            >
              {isCollapsed ? <IconRight /> : <IconDown />}
            </div>
            {!isMarkdown && (
              <Input
                size="mini"
                placeholder="请输入代码块名称"
                value={title}
                onChange={(val) => updateAttributes({ title: val })}
                className={cssPrefix`title-input`}
                disabled={!editable}
              />
            )}
          </div>

          {!isCollapsed && (
            <div className={cssPrefix`header-right`}>
              <Tooltip content="切换代码语言" trigger="hover">
                <div>
                  <Select
                    showSearch
                    size="mini"
                    placeholder="搜索"
                    value={language || ""}
                    onChange={(value) => updateAttributes({ language: value })}
                    className={cssPrefix`lang-select`}
                    bordered={false}
                    disabled={!editable}
                    triggerProps={{
                      autoAlignPopupWidth: false,
                      position: "bl",
                    }}
                  >
                    {supportedLanguages.map((lang) => (
                      <Option key={lang} value={lang}>
                        {lang}
                      </Option>
                    ))}
                  </Select>
                </div>
              </Tooltip>

              <div className={cssPrefix`divider`} />

              <div
                className={cn(
                  cssPrefix`action-btn`,
                  isAutoWrap ? cssPrefix`active` : "",
                )}
                onClick={() => setIsAutoWrap(!isAutoWrap)}
              >
                <IconText1 fontSize="0.8em" />
                <span>自动换行</span>
              </div>

              <div
                className={cn(cssPrefix`divider`, cssPrefix`vertical`)}
              />

              <div className={cssPrefix`action-btn`} onClick={handleCopy}>
                <IconCopy />
                <span>复制</span>
              </div>
            </div>
          )}
        </div>

        {/* Code Content */}
        <div
          className={cn(
            cssPrefix`content`,
            isCollapsed ? cssPrefix`hidden` : "",
          )}
        >
          {/* Line Numbers */}
          <div className={cssPrefix`lines`} contentEditable={false}>
            {Array.from({ length: lineCount }).map((_, i) => (
              <div key={i} className={cssPrefix`line-number`}>
                {i + 1}
              </div>
            ))}
          </div>

          {/* Code Area */}
          <pre className={cssPrefix`pre`}>
            <code style={{ whiteSpace: isAutoWrap ? "pre-wrap" : "pre" }}>
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

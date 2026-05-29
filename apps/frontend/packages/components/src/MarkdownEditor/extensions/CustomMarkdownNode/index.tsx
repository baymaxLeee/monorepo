/**
 * AttachmentNode — 自定义 Markdown 附件节点
 *
 * Markdown 语法：
 *   :attachment[任意JSON]        → 解析为对象/数组/数字等
 *   :attachment[纯字符串]         → JSON.parse 失败时保留原始字符串
 *
 * data 属性存储方括号内的原始字符串，渲染时尝试 JSON.parse
 */

import {
  mergeAttributes,
  Node,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { FC } from "react";

const NODE_NAME = "attachmentNode";
const MD_PREFIX = ":attachment";

/**
 * 尝试 JSON.parse，成功返回解析结果，失败返回原始字符串
 */
function tryParseJSON(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const AttachmentComponent: FC<NodeViewProps> = ({ node }) => {
  const raw: string = node.attrs.data ?? "";
  const parsed = tryParseJSON(raw);
  const isObject = typeof parsed === "object" && parsed !== null;

  return (
    <NodeViewWrapper
      as="div"
      data-type={NODE_NAME}
      style={{
        border: "1px solid rgb(234, 237, 241)",
        borderRadius: 8,
        padding: "8px 12px",
        margin: "8px 0",
        background: "rgb(199, 204, 214)",
        fontSize: 13,
        fontFamily: "monospace",
      }}
    >
      <span style={{ color: "rgb(115, 122, 135)", marginRight: 6 }}>
        attachment
      </span>
      {isObject ? (
        <span style={{ wordBreak: "break-all" }}>
          {JSON.stringify(parsed, null, 0)}
        </span>
      ) : (
        <span style={{ color: "#86909c", wordBreak: "break-all" }}>
          {String(parsed)}
        </span>
      )}
    </NodeViewWrapper>
  );
};

export const AttachmentNode = Node.create({
  name: NODE_NAME,

  group: "block",

  atom: true,

  addAttributes() {
    return {
      data: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${NODE_NAME}"]`,
        getAttrs: (el) => ({
          data: (el as HTMLElement).getAttribute("data-attachment"),
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const raw = HTMLAttributes.data;
    const serialized = typeof raw === "string" ? raw : JSON.stringify(raw);
    return [
      "div",
      mergeAttributes(
        { "data-type": NODE_NAME, "data-attachment": serialized },
        HTMLAttributes,
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentComponent);
  },

  markdownTokenName: NODE_NAME,

  markdownTokenizer: {
    name: NODE_NAME,
    level: "block" as const,
    start: (src: string) => src.indexOf(MD_PREFIX),
    tokenize(src) {
      const re = /^:attachment\[([^\]]*)\](?:\n|$)/;
      const match = re.exec(src);
      if (!match) return undefined;

      return {
        type: NODE_NAME,
        raw: match[0],
        payload: match[1],
      };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode(NODE_NAME, { data: token.payload ?? "" });
  },

  renderMarkdown(node) {
    return `${MD_PREFIX}[${node.attrs?.data ?? ""}]\n`;
  },
});

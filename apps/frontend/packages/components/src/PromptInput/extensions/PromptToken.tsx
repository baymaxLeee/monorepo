import { mergeAttributes, Node } from "@tiptap/core";
import {
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { FileText, ImageIcon, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "shared";
import type { PromptInputRenderContext, PromptInputToken } from "../interface";

export interface PromptTokenOptions {
  renderToken?: (
    token: PromptInputToken,
    context: PromptInputRenderContext,
  ) => ReactNode;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    promptToken: {
      insertPromptToken: (token: PromptInputToken) => ReturnType;
    };
  }
}

const getTokenIcon = (kind: string) => {
  if (kind === "image") return <ImageIcon className="size-3.5" />;
  return <FileText className="size-3.5" />;
};

const PromptTokenView = (props: NodeViewProps) => {
  const { editor, extension, node, selected, getPos } = props;
  const token = node.attrs as PromptInputToken;
  const options = extension.options as PromptTokenOptions;

  const deleteToken = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number" || editor.isDestroyed) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
  };

  const rendered = options.renderToken?.(token, {
    selected,
    deleteToken,
  });

  return (
    <NodeViewWrapper as="span" className="prompt-input-token-wrap">
      {rendered ?? (
        <span
          className={cn(
            "prompt-input-token",
            token.kind === "image" && "prompt-input-token-image",
            selected && "prompt-input-token-selected",
          )}
          data-kind={token.kind}
        >
          {token.kind === "image" && token.url ? (
            <img src={token.url} alt="" className="prompt-input-token-thumb" />
          ) : (
            getTokenIcon(token.kind)
          )}
          <span className="prompt-input-token-label">{token.label}</span>
          <button
            type="button"
            className="prompt-input-token-remove"
            onClick={deleteToken}
            aria-label="Remove token"
          >
            <X className="size-3" />
          </button>
        </span>
      )}
    </NodeViewWrapper>
  );
};

export const createPromptTokenExtension = (options: PromptTokenOptions = {}) =>
  Node.create<PromptTokenOptions>({
    name: "promptToken",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,

    addOptions() {
      return options;
    },

    addAttributes() {
      return {
        id: { default: "" },
        kind: { default: "file" },
        label: { default: "" },
        mime: { default: null },
        size: { default: null },
        url: { default: null },
        meta: { default: null },
      };
    },

    parseHTML() {
      return [{ tag: "span[data-prompt-token]" }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "span",
        mergeAttributes(HTMLAttributes, {
          "data-prompt-token": HTMLAttributes.id,
        }),
      ];
    },

    addCommands() {
      return {
        insertPromptToken:
          (token) =>
          ({ commands }) =>
            commands.insertContent([
              { type: this.name, attrs: token },
              { type: "text", text: " " },
            ]),
      };
    },

    addNodeView() {
      return ReactNodeViewRenderer(PromptTokenView);
    },
  });

import { cn } from "@repo/shared";
import { mergeAttributes, Node } from "@tiptap/core";
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { AlertCircle, Check, FileText, ImageIcon, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";

import type { PromptInputRenderContext, PromptInputToken } from "../interface";

export interface PromptTokenOptions {
  renderToken?: (token: PromptInputToken, context: PromptInputRenderContext) => ReactNode;
  retryToken?: (token: PromptInputToken) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    promptToken: {
      insertPromptToken: (token: PromptInputToken) => ReturnType;
    };
  }
}

const getTokenIcon = (kind: string) => {
  if (kind === "image") {
    return <ImageIcon className="size-3.5" />;
  }
  return <FileText className="size-3.5" />;
};

const PromptTokenView = (props: NodeViewProps) => {
  const { editor, extension, node, selected, getPos } = props;
  const token = node.attrs as PromptInputToken;
  const options = extension.options as PromptTokenOptions;

  const deleteToken = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number" || editor.isDestroyed) {
      return;
    }
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

  const failed = token.status === "failed";
  const isReady = token.status === "ready";

  return (
    <NodeViewWrapper as="span" className="prompt-input-token-wrap">
      {rendered ?? (
        <span
          className={cn(
            "prompt-input-token",
            token.kind === "image" && "prompt-input-token-image",
            selected && "prompt-input-token-selected",
            failed && "prompt-input-token-failed",
            isReady && "prompt-input-token-ready",
          )}
          data-kind={token.kind}
          title={token.error || token.label}
        >
          {isReady ? (
            <Check className="size-3.5 text-foreground" />
          ) : failed ? (
            <AlertCircle className="size-3.5 text-destructive" />
          ) : token.kind === "image" && token.url ? (
            <img src={token.url} alt="" className="prompt-input-token-thumb" />
          ) : (
            getTokenIcon(token.kind)
          )}
          <span className="prompt-input-token-label">{token.label}</span>
          {failed ? (
            <button
              type="button"
              className="prompt-input-token-remove"
              onClick={() => options.retryToken?.(token)}
              aria-label={`重试上传 ${token.label}`}
            >
              <RotateCcw className="size-3" />
            </button>
          ) : null}
          <button
            type="button"
            className="prompt-input-token-remove"
            onClick={deleteToken}
            aria-label={`移除 ${token.label}`}
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
        status: { default: "ready" },
        error: { default: null },
        meta: {
          default: {},
          parseHTML: (element) => {
            const raw = element.getAttribute("data-meta");
            if (!raw) {
              return {};
            }
            try {
              return JSON.parse(raw) as Record<string, unknown>;
            } catch {
              return {};
            }
          },
          renderHTML: (attributes) => ({
            "data-meta": JSON.stringify(attributes.meta ?? {}),
          }),
        },
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

import { mergeAttributes, Node } from "@tiptap/core";
import {
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { AlertCircle, Check, FileText, ImageIcon, X } from "lucide-react";
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

type IngestMeta = {
  clientRef?: string;
  artifactId?: string;
  ingestStatus?: string;
  ingestProgress?: number;
  ingestError?: string;
};

const parseMeta = (value: unknown): IngestMeta => {
  if (!value || typeof value !== "object") return {};
  return value as IngestMeta;
};

const getTokenIcon = (kind: string) => {
  if (kind === "image") return <ImageIcon className="size-3.5" />;
  return <FileText className="size-3.5" />;
};

function TokenProgressRing({ progress }: { progress: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, progress));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <svg
      className="prompt-input-token-ring"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

const PromptTokenView = (props: NodeViewProps) => {
  const { editor, extension, node, selected, getPos } = props;
  const token = node.attrs as PromptInputToken;
  const meta = parseMeta(token.meta);
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

  const ingestStatus = meta.ingestStatus;
  const ingestProgress = Number(meta.ingestProgress ?? 0);
  const failed = ingestStatus === "failed";
  const isReady = ingestStatus === "ready";
  const ingesting = Boolean(
    ingestStatus && !failed && ingestStatus !== "ready",
  );

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
        >
          {ingesting ? (
            <TokenProgressRing progress={ingestProgress} />
          ) : isReady ? (
            <Check className="size-3.5 text-emerald-600" />
          ) : failed ? (
            <AlertCircle className="size-3.5 text-destructive" />
          ) : token.kind === "image" && token.url ? (
            <img src={token.url} alt="" className="prompt-input-token-thumb" />
          ) : (
            getTokenIcon(token.kind)
          )}
          <span className="prompt-input-token-label">{token.label}</span>
          {ingesting ? (
            <span className="prompt-input-token-progress">{ingestProgress}%</span>
          ) : null}
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
        meta: {
          default: {},
          parseHTML: (element) => {
            const raw = element.getAttribute("data-meta");
            if (!raw) return {};
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

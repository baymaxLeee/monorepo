import type { CanvasNode } from "@repo/api";
import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import { exitSuggestion } from "@tiptap/suggestion";

import type { CreativeAssetItem } from "../../hooks/useCreativeAssets";
import { MentionList, type MentionListHandle } from "./MentionList";

const escapeAttribute = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

/** Source AgentFrame's Markdown mention identity and asynchronous selection contract. */
export function createAssetMentionExtension(
  getItems: (query: string) => Promise<CreativeAssetItem[]>,
  onReference: (item: CreativeAssetItem) => Promise<CanvasNode>,
) {
  return Mention.extend({
    renderMarkdown(node) {
      return `<span data-type="mention" data-id="${escapeAttribute(String(node.attrs?.id ?? ""))}" data-label="${escapeAttribute(String(node.attrs?.label ?? ""))}"></span>`;
    },
  }).configure({
    HTMLAttributes: { class: "canvas-asset-mention" },
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    suggestion: {
      char: "@",
      allowSpaces: true,
      allowedPrefixes: null,
      items: ({ query }) => getItems(query),
      command: ({ editor, range, props }) => {
        const item = props as unknown as CreativeAssetItem;
        void onReference(item).then((node) => {
          if (editor.isDestroyed) return;
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: "mention", attrs: { id: node.id, label: node.name } },
              { type: "text", text: " " },
            ])
            .run();
        });
      },
      render: () => {
        let component: ReactRenderer<MentionListHandle> | null = null;
        let close: (() => void) | undefined;
        let clientRect: (() => DOMRect | null) | null | undefined;
        const position = () => {
          const rectangle = clientRect?.();
          if (!component || !rectangle) return;
          const height = Math.min(component.element.getBoundingClientRect().height, 320);
          Object.assign(component.element.style, {
            position: "fixed",
            zIndex: "1000",
            left: `${Math.max(12, Math.min(rectangle.left, window.innerWidth - 312))}px`,
            top: `${rectangle.bottom + height + 12 > window.innerHeight ? Math.max(12, rectangle.top - height - 8) : rectangle.bottom + 8}px`,
          });
        };
        const outside = (event: PointerEvent) => {
          if (!component?.element.contains(event.target as Node)) close?.();
        };
        return {
          onStart(props) {
            close = () => exitSuggestion(props.editor.view);
            clientRect = props.clientRect;
            component = new ReactRenderer(MentionList, { props, editor: props.editor });
            document.body.appendChild(component.element);
            position();
            document.addEventListener("pointerdown", outside, true);
            window.addEventListener("scroll", position, true);
            window.addEventListener("resize", position);
          },
          onUpdate(props) {
            clientRect = props.clientRect;
            component?.updateProps(props);
            position();
          },
          onKeyDown({ event }) {
            if (event.key === "Escape") {
              close?.();
              return true;
            }
            return component?.ref?.onKeyDown(event) ?? false;
          },
          onExit() {
            document.removeEventListener("pointerdown", outside, true);
            window.removeEventListener("scroll", position, true);
            window.removeEventListener("resize", position);
            component?.element.remove();
            component?.destroy();
            component = null;
          },
        };
      },
    },
  });
}

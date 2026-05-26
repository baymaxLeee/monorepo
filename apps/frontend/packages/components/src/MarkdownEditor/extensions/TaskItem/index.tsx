import type { Node } from "@tiptap/core";
import TiptapTaskItem from "@tiptap/extension-task-item";

export const createTaskItemExtension = (): Node =>
  TiptapTaskItem.configure({
    nested: true,
  }).extend({
    addNodeView() {
      const parentNodeView = this.parent?.();
      if (!parentNodeView) return undefined as never;

      const syncTaskItemStyle = (
        element: HTMLElement,
        attrs: Record<string, any>,
      ) => {
        const indent = attrs.indent || 0;
        if (indent > 0) {
          element.style.marginLeft = `${indent * 2}em`;
          element.dataset.indent = String(indent);
        } else {
          element.style.marginLeft = "";
          delete element.dataset.indent;
        }

        const textAlign = attrs.textAlign;
        if (typeof textAlign === "string" && textAlign.length > 0) {
          element.style.textAlign = textAlign;
          element.dataset.textAlign = textAlign;
        } else {
          element.style.textAlign = "";
          delete element.dataset.textAlign;
        }
      };

      return (props) => {
        const nodeView = parentNodeView(props);
        if (nodeView.dom instanceof HTMLElement) {
          syncTaskItemStyle(nodeView.dom, props.node.attrs);
        }
        const originalUpdate = nodeView.update;
        nodeView.update = (updatedNode, ...rest) => {
          const result = originalUpdate?.(updatedNode, ...rest) ?? false;
          if (result && nodeView.dom instanceof HTMLElement) {
            syncTaskItemStyle(nodeView.dom, updatedNode.attrs);
          }
          return result;
        };
        return nodeView;
      };
    },
  });

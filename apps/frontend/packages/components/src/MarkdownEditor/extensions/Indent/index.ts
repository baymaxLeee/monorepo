import { Extension } from "@tiptap/core";
import { toast } from "sonner";
import type { ContentType } from "../../interface";

export interface IndentOptions {
  types: string[];
  minIndent: number;
  maxIndent: number;
  defaultIndent: number;
  contentType: ContentType;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType;
      outdent: (options?: { silent?: boolean }) => ReturnType;
    };
  }
}

const WRAPPER_BLOCK_TYPES = new Set(["listItem", "taskItem"]);

export const createIndentExtension = () =>
  Extension.create<IndentOptions>({
    name: "indent",

    addOptions() {
      return {
        types: ["paragraph", "heading", ...WRAPPER_BLOCK_TYPES],
        minIndent: 0,
        maxIndent: 2,
        defaultIndent: 0,
        contentType: "html",
      };
    },

    addGlobalAttributes() {
      return [
        {
          types: this.options.types,
          attributes: {
            indent: {
              default: this.options.defaultIndent,
              parseHTML: (element) => {
                const dataIndent = element.getAttribute("data-indent");
                if (dataIndent) return Number(dataIndent);

                const marginLeft = element.style.marginLeft;
                if (marginLeft) return Math.round(parseFloat(marginLeft) / 2);

                return this.options.defaultIndent;
              },
              renderHTML: (attributes) => {
                if (!attributes.indent || attributes.indent === 0) {
                  return {};
                }
                return {
                  style: `margin-left: ${attributes.indent * 2}em`,
                  "data-indent": attributes.indent,
                };
              },
            },
          },
        },
      ];
    },

    addCommands() {
      return {
        indent:
          () =>
          ({ tr, state }) => {
            const { selection } = state;
            let changed = false;
            tr.setSelection(selection);
            tr.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                const currentIndent = node.attrs.indent || 0;
                if (currentIndent < this.options.maxIndent) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: currentIndent + 1,
                  });
                  changed = true;
                }
                if (WRAPPER_BLOCK_TYPES.has(node.type.name)) {
                  return false;
                }
              }
              return true;
            });
            if (!changed) {
              toast.warning("已达到最大缩进层级");
            }
            return true;
          },
        outdent:
          (options) =>
          ({ tr, state }) => {
            const { selection } = state;
            let changed = false;
            tr.setSelection(selection);
            tr.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                const currentIndent = node.attrs.indent || 0;
                if (currentIndent > this.options.minIndent) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: currentIndent - 1,
                  });
                  changed = true;
                }
                if (WRAPPER_BLOCK_TYPES.has(node.type.name)) {
                  return false;
                }
              }
              return true;
            });
            if (!changed && !options?.silent) {
              toast.warning("已达到最小缩进层级");
            }
            return changed;
          },
      };
    },

    addKeyboardShortcuts() {
      return {
        Tab: () => {
          if (this.editor.isActive("codeBlock")) {
            return this.editor.commands.insertContent("  ");
          }
          if (this.editor.isActive("listItem")) {
            return this.editor.commands.sinkListItem("listItem");
          }
          if (this.editor.isActive("taskItem")) {
            return this.editor.commands.sinkListItem("taskItem");
          }
          if (this.options.contentType === "markdown") return false;
          return this.editor.commands.indent();
        },
        Backspace: () => {
          if (this.options.contentType === "markdown") return false;
          const { selection } = this.editor.state;
          if (selection.empty && selection.$from.parentOffset === 0) {
            return this.editor.commands.outdent({ silent: true });
          }
          return false;
        },
      };
    },
  });

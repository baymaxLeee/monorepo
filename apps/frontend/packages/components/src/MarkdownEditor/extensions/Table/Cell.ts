import { mergeAttributes, Node } from "@tiptap/core";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cn } from "shared";
import { slotClassNameFactory } from "../../../compat/className";
import { findTable, getCellsInColumn, isRowSelected, selectRow } from "./utils";

const cssPrefix = slotClassNameFactory("markdown-editor-table");

export interface TableCellOptions {
  HTMLAttributes: Record<string, any>;
}

export const createTableCellExtension = () => {
  const rowGripKey = new PluginKey<DecorationSet>("tableRowGrip");

  return Node.create<TableCellOptions>({
    name: "tableCell",

    content: "block+",

    tableRole: "cell",

    isolating: true,

    addOptions() {
      return {
        HTMLAttributes: {},
      };
    },

    parseHTML() {
      return [{ tag: "td" }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "td",
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
        0,
      ];
    },

    addAttributes() {
      return {
        colspan: {
          default: 1,
          parseHTML: (element) => {
            const colspan = element.getAttribute("colspan");
            return colspan ? parseInt(colspan, 10) : 1;
          },
        },
        rowspan: {
          default: 1,
          parseHTML: (element) => {
            const rowspan = element.getAttribute("rowspan");
            return rowspan ? parseInt(rowspan, 10) : 1;
          },
        },
        colwidth: {
          default: null,
          parseHTML: (element) => {
            const colwidth = element.getAttribute("colwidth");
            return colwidth ? [parseInt(colwidth, 10)] : null;
          },
        },
        style: {
          default: null,
        },
      };
    },

    addProseMirrorPlugins() {
      const { editor } = this;

      const buildDecorations = (state: EditorState): DecorationSet => {
        if (!editor.isEditable) return DecorationSet.empty;

        const { doc, selection } = state;
        const table = findTable(selection);
        if (!table) return DecorationSet.empty;

        const cells = getCellsInColumn(0)(selection);
        const map = TableMap.get(table.node);
        if (!cells) return DecorationSet.empty;

        const decorations: Decoration[] = [];
        cells.forEach(({ pos }: { pos: number }, index: number) => {
          const rect = map.findCell(pos - table.start);
          const rowIndex = rect.top;

          decorations.push(
            Decoration.widget(pos + 1, () => {
              const rowSelected = isRowSelected(rowIndex)(selection);

              const grip = document.createElement("span");
              grip.className = cn(
                cssPrefix`grip-row`,
                rowSelected && cssPrefix`grip-row-selected`,
                index === 0 && cssPrefix`grip-row-first`,
                index === cells.length - 1 && cssPrefix`grip-row-last`,
              );
              grip.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                editor.view.dispatch(selectRow(rowIndex)(editor.state.tr));
              });

              return grip;
            }),
          );
        });

        return DecorationSet.create(doc, decorations);
      };

      return [
        new Plugin<DecorationSet>({
          key: rowGripKey,
          state: {
            init(_, state) {
              return buildDecorations(state);
            },
            apply(tr, value, oldState, newState) {
              // Reuse cached decorations when neither doc nor selection changed
              if (!tr.docChanged && oldState.selection.eq(newState.selection)) {
                return value;
              }
              return buildDecorations(newState);
            },
          },
          props: {
            decorations: (state) =>
              rowGripKey.getState(state) ?? DecorationSet.empty,
          },
        }),
      ];
    },
  });
};

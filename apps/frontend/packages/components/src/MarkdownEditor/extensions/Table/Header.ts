import TiptapTableHeader from "@tiptap/extension-table-header";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cn } from "shared";
import {
  findTable,
  getCellsInRow,
  isColumnSelected,
  selectColumn,
} from "./utils";

export const createTableHeaderExtension = () => {
  const columnGripKey = new PluginKey<DecorationSet>("tableColumnGrip");

  return TiptapTableHeader.extend({
    addAttributes() {
      return {
        colspan: {
          default: 1,
        },
        rowspan: {
          default: 1,
        },
        colwidth: {
          default: null,
          parseHTML: (element) => {
            const colwidth = element.getAttribute("colwidth");
            return colwidth
              ? colwidth.split(",").map((item) => parseInt(item, 10))
              : null;
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

        const cells = getCellsInRow(0)(selection);
        const map = TableMap.get(table.node);
        if (!cells) return DecorationSet.empty;

        const decorations: Decoration[] = [];
        cells.forEach(({ pos }: { pos: number }, index: number) => {
          const rect = map.findCell(pos - table.start);
          const colIndex = rect.left;

          decorations.push(
            Decoration.widget(pos + 1, () => {
              const colSelected = isColumnSelected(colIndex)(selection);

              const grip = document.createElement("span");
              grip.className = cn(
                "markdown-editor-table-grip-column",
                colSelected && "markdown-editor-table-grip-column-selected",
                index === 0 && "markdown-editor-table-grip-column-first",
                index === cells.length - 1 &&
                  "markdown-editor-table-grip-column-last",
              );
              grip.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                editor.view.dispatch(selectColumn(colIndex)(editor.state.tr));
              });

              return grip;
            }),
          );
        });

        return DecorationSet.create(doc, decorations);
      };

      return [
        new Plugin<DecorationSet>({
          key: columnGripKey,
          state: {
            init(_, state) {
              return buildDecorations(state);
            },
            apply(tr, value, oldState, newState) {
              if (!tr.docChanged && oldState.selection.eq(newState.selection)) {
                return value;
              }
              return buildDecorations(newState);
            },
          },
          props: {
            decorations: (state) =>
              columnGripKey.getState(state) ?? DecorationSet.empty,
          },
        }),
      ];
    },
  });
};

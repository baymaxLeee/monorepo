import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import {
  getClipboardImageFiles,
  isSelectionInsideTableCell,
} from "../../utils";

export const createPasteFlattenExtension = () =>
  Extension.create({
    name: "pasteFlatten",

    addProseMirrorPlugins() {
      const { editor } = this;

      return [
        new Plugin({
          props: {
            handlePaste: (view, event, slice) => {
              const { state } = view;
              const { selection, schema } = state;
              const { $from } = selection;

              const imageFiles = getClipboardImageFiles(event);
              if (imageFiles.length > 0) {
                editor.chain().focus().insertImages(imageFiles).run();
                return true;
              }

              if (isSelectionInsideTableCell(selection)) return false;

              if ($from.depth <= 1) {
                if (slice.content.size === 0) return true;
                view.dispatch(
                  state.tr.replaceSelection(slice).scrollIntoView(),
                );
                return true;
              }

              const insertPos = $from.after(1);
              const paragraph = schema.nodes.paragraph.create();
              const tr = state.tr.insert(insertPos, paragraph);
              tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
              tr.replaceSelection(slice);
              tr.scrollIntoView();
              view.dispatch(tr);
              return true;
            },
          },
        }),
      ];
    },
  });

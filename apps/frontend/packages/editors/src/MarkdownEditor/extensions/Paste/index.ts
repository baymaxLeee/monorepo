import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";

import { getClipboardImageFiles, isSelectionInsideTableCell } from "../../utils";

interface PasteFlattenOptions {
  codeBlock?: boolean;
}

export const flattenPastedCodeBlocks = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;

  container.querySelectorAll("pre").forEach((pre) => {
    if (!pre.querySelector("code")) return;

    const paragraph = document.createElement("p");
    const lines = (pre.textContent ?? "").replace(/\r\n/g, "\n").split("\n");
    lines.forEach((line, index) => {
      if (index > 0) paragraph.appendChild(document.createElement("br"));
      paragraph.appendChild(document.createTextNode(line));
    });
    pre.replaceWith(paragraph);
  });

  return container.innerHTML;
};

export const createPasteFlattenExtension = (options: PasteFlattenOptions = {}) =>
  Extension.create({
    name: "pasteFlatten",

    addProseMirrorPlugins() {
      const { editor } = this;

      return [
        new Plugin({
          props: {
            transformPastedHTML: options.codeBlock === false ? (html) => flattenPastedCodeBlocks(html) : undefined,
            handlePaste: (view, event, slice) => {
              const { state } = view;
              const { selection, schema } = state;
              const { $from } = selection;

              const imageFiles = getClipboardImageFiles(event);
              if (imageFiles.length > 0) {
                editor.chain().focus().insertImages(imageFiles).run();
                return true;
              }

              if (isSelectionInsideTableCell(selection)) {
                return false;
              }

              if ($from.depth <= 1) {
                if (slice.content.size === 0) {
                  return true;
                }
                view.dispatch(state.tr.replaceSelection(slice).scrollIntoView());
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

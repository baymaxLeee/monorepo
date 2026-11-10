import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { getClipboardImageFiles } from "../../utils";

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
            handlePaste: (_view, event) => {
              const imageFiles = getClipboardImageFiles(event);
              if (imageFiles.length > 0) {
                return editor.commands.insertImages(imageFiles);
              }
              return false;
            },
          },
        }),
      ];
    },
  });

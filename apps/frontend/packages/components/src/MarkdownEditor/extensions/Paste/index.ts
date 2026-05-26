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

              // file 优先 文件系统复制/web右键复制/截图
              const imageFiles = getClipboardImageFiles(event);
              if (imageFiles.length > 0) {
                editor.chain().focus().insertImages(imageFiles).run();
                return true;
              }

              // tableCell内允许复杂嵌套 交给 PM 处理
              if (isSelectionInsideTableCell(selection)) return false;

              // 顶层块直接粘贴
              if ($from.depth <= 1) {
                if (slice.content.size === 0) return true;
                view.dispatch(
                  state.tr.replaceSelection(slice).scrollIntoView(),
                );
                return true;
              }

              // 嵌套块：跳到顶层块之后新起空 paragraph 再粘贴 slice
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

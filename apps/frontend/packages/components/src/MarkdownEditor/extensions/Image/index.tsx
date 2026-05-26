import { Spin } from "../../../compat/legacy-ui";
import { Image as TiptapImage } from "@tiptap/extension-image";
import { TextSelection } from "@tiptap/pm/state";
import {
  NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { cn } from "shared";
import React, { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { slotClassNameFactory } from "../../../compat/className";
import { isSelectionInsideTableCell } from "../../utils";

const cssPrefix = slotClassNameFactory("markdown-editor-image");

export interface CreateImageExtensionOptions {
  onUpload?: (file: File) => Promise<string>;
  imageLoader?: (key: string) => Promise<string>;
}

interface ImageStorage {
  pendingFiles: Map<string, File>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imageFile: {
      insertImages: (files: File[]) => ReturnType;
    };
  }

  interface Storage {
    imageFile: ImageStorage;
  }
}

export const ImageNodeView: React.FC<NodeViewProps> = (props) => {
  const { node, selected, editor, getPos, extension } = props;
  const { src, alt, title, uploadId } = node.attrs as {
    src: string | null;
    alt?: string;
    title?: string;
    uploadId: string | null;
  };
  const { onUpload, imageLoader } =
    extension?.options as CreateImageExtensionOptions;
  const storage = extension?.storage as ImageStorage | undefined;
  const hasPendingFile = !!uploadId && !!storage?.pendingFiles.has(uploadId);

  const [imgSrc, setImgSrc] = useState<string>();
  const [loading, setLoading] = useState<boolean>(hasPendingFile);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (hasPendingFile) return;
    if (!src) {
      setImgSrc(undefined);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const finalUrl = imageLoader ? await imageLoader(src) : src;
        if (cancelled) return;
        setImgSrc(finalUrl);
        setLoading(false);
        setError(false);
      } catch (err) {
        console.error("[image] load failed:", err);
        if (cancelled) return;
        setImgSrc(src);
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (!hasPendingFile) return;

    let cancelled = false;
    let blobUrl: string | null = null;

    const init = async () => {
      const file = storage?.pendingFiles.get(uploadId!);
      if (!file) return;

      blobUrl = URL.createObjectURL(file);
      if (!cancelled) {
        setImgSrc(blobUrl);
        setLoading(true);
        setError(false);
      }

      try {
        if (!onUpload) throw new Error("onUpload is not configured");
        const realUrl = await onUpload(file);
        if (!realUrl) throw new Error("onUpload returned empty url");
        if (cancelled) return;

        // 持久化 src + 清 uploadId。addToHistory: false 使得命令层的"插入 N 张图"
        // 保持为单步 undo，异步回填不占用额外 history
        const pos = typeof getPos === "function" ? getPos() : null;
        storage?.pendingFiles.delete(uploadId!);
        if (typeof pos === "number" && !editor.isDestroyed) {
          const fresh = editor.state.doc.nodeAt(pos);
          if (fresh && fresh.type.name === "image") {
            const tr = editor.state.tr
              .setNodeMarkup(pos, undefined, {
                ...fresh.attrs,
                src: realUrl,
                uploadId: null,
              })
              .setMeta("addToHistory", false);
            editor.view.dispatch(tr);
          }
        }
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      } catch (err) {
        console.error("[image] init failed:", err);
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
        storage?.pendingFiles.delete(uploadId);
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, []);

  return (
    <NodeViewWrapper
      className={cn(cssPrefix`wrapper`, {
        [cssPrefix`selected`]: selected,
      })}
    >
      <img className={cssPrefix`img`} src={imgSrc} alt={alt} title={title} />
      {loading && !error && (
        <div className={cssPrefix`overlay`}>
          <Spin />
        </div>
      )}
      {error && <div className={cssPrefix`error-overlay`}>上传失败</div>}
    </NodeViewWrapper>
  );
};

export const createImageExtension = ({
  onUpload,
  imageLoader,
}: CreateImageExtensionOptions = {}) =>
  TiptapImage.extend<CreateImageExtensionOptions, ImageStorage>({
    addOptions() {
      return {
        ...this.parent?.(),
        onUpload,
        imageLoader,
      };
    },

    addStorage() {
      return {
        pendingFiles: new Map<string, File>(),
      };
    },

    addAttributes() {
      const parent = this.parent?.() ?? {};
      return {
        ...parent,
        uploadId: {
          default: null,
          rendered: false,
          parseHTML: () => null,
        },
      };
    },

    addCommands() {
      const parent = this.parent?.() ?? {};
      return {
        ...parent,
        insertImages:
          (files: File[]) =>
          ({ commands, state, tr }) => {
            if (files.length === 0 || !this.options.onUpload) return false;

            const storage = this.storage as ImageStorage;
            const entries = files.map((file) => {
              const uploadId = uuidv4();
              storage.pendingFiles.set(uploadId, file);
              return { uploadId };
            });
            const rollback = () => {
              entries.forEach(({ uploadId }) =>
                storage.pendingFiles.delete(uploadId),
              );
            };

            const { selection, schema } = state;
            const { $from } = selection;
            const attrsList = entries.map(({ uploadId }) => ({ uploadId }));

            if ($from.depth <= 1 || isSelectionInsideTableCell(selection)) {
              // 顶层块 / 表格单元格内：直接按当前光标位置插入
              const inserted = commands.insertContent(
                attrsList.map((attrs) => ({ type: "image", attrs })),
              );
              if (!inserted) {
                rollback();
                return false;
              }
            } else {
              // 嵌套在 quote / list / details 等其它 block 内：
              // 跳到当前顶层块之后作为新的顶层 block 依次插入，不允许 image 嵌套
              const imageNodes = attrsList.map((attrs) =>
                schema.nodes.image.create(attrs),
              );
              const insertPos = $from.after(1);
              tr.insert(insertPos, imageNodes);
              const endPos =
                insertPos + imageNodes.reduce((sum, n) => sum + n.nodeSize, 0);
              tr.setSelection(TextSelection.near(tr.doc.resolve(endPos)));
              tr.scrollIntoView();
            }

            return true;
          },
      };
    },

    addNodeView() {
      return ReactNodeViewRenderer(ImageNodeView);
    },
  });

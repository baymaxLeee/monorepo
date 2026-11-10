import { cn } from "@repo/shared";
import { Image as TiptapImage } from "@tiptap/extension-image";
import { TextSelection } from "@tiptap/pm/state";
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import { isSelectionInsideTableCell } from "../../utils";

export interface CreateImageExtensionOptions {
  onUpload?: (file: File) => Promise<string>;
  imageLoader?: (key: string) => Promise<string>;
  getOnUpload?: () => ((file: File) => Promise<string>) | undefined;
  getImageLoader?: () => ((key: string) => Promise<string>) | undefined;
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
    image: ImageStorage;
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
  const options = (extension?.options ?? {}) as Partial<CreateImageExtensionOptions>;
  const storage = extension?.storage as ImageStorage | undefined;
  const hasPendingFile = !!uploadId && !!storage?.pendingFiles.has(uploadId);

  const [imgSrc, setImgSrc] = useState<string>();
  const [loading, setLoading] = useState<boolean>(hasPendingFile);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (hasPendingFile) {
      return;
    }
    if (!src) {
      setImgSrc(undefined);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const imageLoader = options.getImageLoader?.() ?? options.imageLoader;
        const finalUrl = imageLoader ? await imageLoader(src) : src;
        if (cancelled) {
          return;
        }
        setImgSrc(finalUrl);
        setLoading(false);
        setError(false);
      } catch (err) {
        console.error("[image] load failed:", err);
        if (cancelled) {
          return;
        }
        setImgSrc(src);
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [options, src]);

  useEffect(() => {
    if (!hasPendingFile) {
      return;
    }

    let cancelled = false;
    let blobUrl: string | null = null;

    const init = async () => {
      const file = storage?.pendingFiles.get(uploadId);
      if (!file) {
        return;
      }

      blobUrl = URL.createObjectURL(file);
      if (!cancelled) {
        setImgSrc(blobUrl);
        setLoading(true);
        setError(false);
      }

      try {
        const onUpload = options.getOnUpload?.() ?? options.onUpload;
        if (!onUpload) {
          throw new Error("onUpload is not configured");
        }
        const realUrl = await onUpload(file);
        if (!realUrl) {
          throw new Error("onUpload returned empty url");
        }
        if (cancelled) {
          return;
        }

        const pos = typeof getPos === "function" ? getPos() : null;
        storage?.pendingFiles.delete(uploadId);
        if (typeof pos === "number" && !editor.isDestroyed) {
          const fresh = editor.state.doc.nodeAt(pos);
          if (fresh?.type.name === "image" && fresh.attrs.uploadId === uploadId) {
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
      storage?.pendingFiles.delete(uploadId);
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [editor, getPos, hasPendingFile, options, storage, uploadId]);

  return (
    <NodeViewWrapper
      className={cn(
        "relative inline-block leading-none outline-none",
        selected && "outline outline-2 outline-blue-500",
      )}
    >
      <img className="block max-w-full" src={imgSrc} alt={alt} title={title} />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center border border-red-500/60 bg-red-500/10 text-xs leading-none text-red-700">
          上传失败
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const createImageExtension = ({
  onUpload,
  imageLoader,
  getOnUpload,
  getImageLoader,
}: CreateImageExtensionOptions = {}) =>
  TiptapImage.extend<CreateImageExtensionOptions, ImageStorage>({
    addOptions() {
      return {
        ...this.parent?.(),
        onUpload,
        imageLoader,
        getOnUpload,
        getImageLoader,
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
            const upload = this.options.getOnUpload?.() ?? this.options.onUpload;
            if (files.length === 0 || !upload) {
              return false;
            }

            const storage = this.storage;
            const entries = files.map((file) => {
              const uploadId = uuidv4();
              storage.pendingFiles.set(uploadId, file);
              return { uploadId };
            });
            const rollback = () => {
              entries.forEach(({ uploadId }) => storage.pendingFiles.delete(uploadId));
            };

            const { selection, schema } = state;
            const { $from } = selection;
            const attrsList = entries.map(({ uploadId }) => ({ uploadId }));

            if ($from.depth <= 1 || isSelectionInsideTableCell(selection)) {
              const inserted = commands.insertContent(attrsList.map((attrs) => ({ type: "image", attrs })));
              if (!inserted) {
                rollback();
                return false;
              }
            } else {
              const imageNodes = attrsList.map((attrs) => schema.nodes.image.create(attrs));
              const insertPos = $from.after(1);
              tr.insert(insertPos, imageNodes);
              const endPos = insertPos + imageNodes.reduce((sum, n) => sum + n.nodeSize, 0);
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

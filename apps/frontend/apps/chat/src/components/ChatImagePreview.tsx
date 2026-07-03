import { ImagePreview } from "components";
import { useShallow } from "zustand/react/shallow";
import { useDocumentBlobUrls } from "../hooks/useDocumentSource";
import { useChatStore } from "../store/useChatStore";

// Bridges the chat store's image-preview slice to the reusable <ImagePreview>:
// it resolves each document ref to a blob URL and feeds the group to the
// lightbox. Mounted once per chat page; the actual open trigger comes from
// image cards / attachments via `openImagePreview`.
export function ChatImagePreview() {
  const { imagePreview, closeImagePreview, setImagePreviewIndex } =
    useChatStore(
      useShallow((s) => ({
        imagePreview: s.imagePreview,
        closeImagePreview: s.closeImagePreview,
        setImagePreviewIndex: s.setImagePreviewIndex,
      })),
    );
  const { open, conversationId, images, index } = imagePreview;

  const documentIds = open ? images.map((image) => image.documentId) : [];
  const urls = useDocumentBlobUrls(conversationId ?? undefined, documentIds);
  const items = images.map((image, i) => ({
    src: urls[i],
    alt: image.filename,
  }));

  return (
    <ImagePreview
      images={items}
      open={open}
      index={index}
      onOpenChange={(next) => {
        if (!next) closeImagePreview();
      }}
      onIndexChange={setImagePreviewIndex}
    />
  );
}

import { GenerationEditorModal } from "./GenerationEditorModal";
import { type ImageGenerationEditorProps, ImageGenerationEditor } from "./ImageGenerationEditor";

export function ImageGenerationEditorModal({
  onClose,
  title,
  visible,
  zIndex,
  ...editorProps
}: ImageGenerationEditorProps & {
  onClose: () => void;
  title: string;
  visible: boolean;
  zIndex?: number;
}) {
  return (
    <GenerationEditorModal onClose={onClose} visible={visible} zIndex={zIndex}>
      <ImageGenerationEditor {...editorProps} expanded onCollapse={onClose} title={title} />
    </GenerationEditorModal>
  );
}

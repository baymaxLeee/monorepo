import { GenerationEditorDialog } from "./GenerationEditorDialog";
import { type ImageGenerationEditorProps, ImageGenerationEditor } from "./ImageGenerationEditor";

export function ImageGenerationEditorDialog({
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
    <GenerationEditorDialog onClose={onClose} visible={visible} zIndex={zIndex}>
      <ImageGenerationEditor {...editorProps} expanded onCollapse={onClose} title={title} />
    </GenerationEditorDialog>
  );
}

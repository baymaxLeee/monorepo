import { GenerationEditorDialog } from "./GenerationEditorDialog";
import { type ImageGenerationEditorProps, ImageGenerationEditor } from "./ImageGenerationEditor";

export function ImageGenerationEditorDialog({
  onClose,
  title,
  visible,
  ...editorProps
}: ImageGenerationEditorProps & {
  onClose: () => void;
  title: string;
  visible: boolean;
}) {
  return (
    <GenerationEditorDialog onClose={onClose} visible={visible}>
      <ImageGenerationEditor {...editorProps} expanded onCollapse={onClose} title={title} />
    </GenerationEditorDialog>
  );
}

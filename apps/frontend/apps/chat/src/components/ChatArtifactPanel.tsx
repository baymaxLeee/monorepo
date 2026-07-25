import { useChatStore } from "../store/useChatStore";
import { ChatDocumentArtifactPanel } from "./ChatDocumentArtifactPanel";
import { ChatFileArtifactPanel } from "./ChatFileArtifactPanel";

export function ChatArtifactPanel({ onClose }: { onClose?: () => void }) {
  const path = useChatStore((state) => state.artifactPreview.path);
  return path ? <ChatFileArtifactPanel onClose={onClose} /> : <ChatDocumentArtifactPanel onClose={onClose} />;
}

import { FileTextIcon } from "lucide-react";
import { cn } from "shared";
import { parseSlots } from "shared";

export interface PromptMessageDocument {
  id: string;
  title?: string;
  filename?: string;
}

export interface PromptMessageContentProps {
  content: string;
  documents: Map<string, PromptMessageDocument>;
  className?: string;
  onOpenDocument?: (documentId: string) => void;
}

export function PromptMessageContent({
  content,
  documents,
  className,
  onOpenDocument,
}: PromptMessageContentProps) {
  const segments = parseSlots(content);
  if (segments.length === 0) {
    return null;
  }

  return (
    <span className={cn("inline whitespace-pre-wrap break-words leading-relaxed", className)}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={`text-${index}`}>{segment.text}</span>;
        }
        const document = documents.get(segment.documentId);
        return (
          <button
            key={`slot-${segment.documentId}-${index}`}
            type="button"
            className="prompt-input-token mx-0.5 align-middle"
            onClick={() => onOpenDocument?.(segment.documentId)}
          >
            <FileTextIcon className="size-3.5" />
            <span className="prompt-input-token-label">
              {document?.title ?? document?.filename ?? segment.documentId}
            </span>
          </button>
        );
      })}
    </span>
  );
}

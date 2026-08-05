import { PluginKey } from "@tiptap/pm/state";
import { FileText, ImageIcon } from "lucide-react";

import type { PromptInputToken, PromptMentionItem, PromptMentionSource } from "../interface";
import { createSuggestionExtension } from "./Suggestion";

export const mentionPluginKey = new PluginKey("promptMention");

/**
 * `@` mention. Reuses the existing `promptToken` inline node, so a picked entity
 * becomes the same chip as an attachment. The host carries `artifactId` in
 * `meta`, which lets submit map it straight to an official `FileUIPart`. The
 * token is pre-marked `ready` because a mentioned file is already uploaded.
 */
export function buildMentionExtension(source: PromptMentionSource) {
  return createSuggestionExtension<PromptMentionItem>({
    name: "promptMention",
    char: "@",
    pluginKey: mentionPluginKey,
    allowSpaces: true,
    debounce: 150,
    items: (query, signal) => source(query, signal),
    getItemKey: (item) => item.id,
    renderItem: (item) => (
      <>
        <span className="prompt-input-suggestion-icon">
          {item.kind === "image" ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
        </span>
        <span className="prompt-input-suggestion-text">
          <span className="prompt-input-suggestion-label">{item.label}</span>
          {item.description ? <span className="prompt-input-suggestion-desc">{item.description}</span> : null}
        </span>
      </>
    ),
    onSelect: (editor, range, item) => {
      const token: PromptInputToken = {
        id: item.id,
        kind: item.kind ?? "file",
        label: item.label,
        mime: item.mime,
        url: item.url,
        meta: {
          origin: "mention",
          ingestStatus: "ready",
          ...item.meta,
        },
      };
      editor.chain().focus().deleteRange(range).insertPromptToken(token).run();
    },
  });
}

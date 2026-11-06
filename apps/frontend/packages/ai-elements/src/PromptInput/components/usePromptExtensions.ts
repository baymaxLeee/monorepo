import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useMemo, useRef, type RefObject } from "react";

import { buildMentionExtension } from "../extensions/mention";
import { createPromptTokenExtension } from "../extensions/PromptToken";
import { buildSlashExtension } from "../extensions/slash";
import type { PromptInputApi, PromptInputProps, PromptInputToken } from "../interface";
import type { PromptSuggestionController } from "./usePromptSuggestions";

export function usePromptExtensions(
  props: PromptInputProps,
  controller: PromptSuggestionController,
  apiRef: RefObject<PromptInputApi | null>,
  retryRef: RefObject<(token: PromptInputToken) => void>,
) {
  const { renderToken, mentionSource, slashCommands, onSkillsLoad, onSlashCommand } = props;
  const renderTokenRef = useRef(renderToken);
  const mentionSourceRef = useRef(mentionSource);
  const slashCommandsRef = useRef(slashCommands);
  const onSkillsLoadRef = useRef(onSkillsLoad);
  const onSlashCommandRef = useRef(onSlashCommand);

  renderTokenRef.current = renderToken;
  mentionSourceRef.current = mentionSource;
  slashCommandsRef.current = slashCommands;
  onSkillsLoadRef.current = onSkillsLoad;
  onSlashCommandRef.current = onSlashCommand;

  return useMemo<Extensions>(() => {
    const list: Extensions = [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        orderedList: false,
      }),
      createPromptTokenExtension({
        renderToken: (token, context) => renderTokenRef.current?.(token, context),
        retryToken: (token) => retryRef.current(token),
      }),
    ];
    if (mentionSource) {
      list.push(buildMentionExtension((query, signal) => mentionSourceRef.current?.(query, signal) ?? [], controller));
    }
    if (slashCommands || onSkillsLoad || onSlashCommand) {
      list.push(
        buildSlashExtension({
          controller,
          getSource: () => slashCommandsRef.current,
          getOnSkillsLoad: () => onSkillsLoadRef.current,
          getApi: () => apiRef.current,
          onCommand: (command, currentApi) => onSlashCommandRef.current?.(command, currentApi),
        }),
      );
    }
    return list;
  }, []);
}

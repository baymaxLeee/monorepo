import { PluginKey } from "@tiptap/pm/state";
import { Sparkles } from "lucide-react";

import type { PromptInputApi, PromptSkillsLoad, PromptSlashCommand, PromptSlashSource } from "../interface";
import { createSuggestionExtension } from "./Suggestion";

export const slashPluginKey = new PluginKey("promptSlash");

/**
 * Placeholder command set, modelled on Cursor/Codex slash menus. The theme is
 * "invoke a skill"; real behaviour is deferred to the host via `onSlashCommand`
 * until backend skill capabilities are wired up.
 */
export const DEFAULT_SLASH_COMMANDS: PromptSlashCommand[] = [
  {
    id: "skills",
    title: "技能",
    description: "浏览并调用可用技能",
    keywords: ["skill", "skills", "技能"],
  },
  {
    id: "plan",
    title: "规划",
    description: "先制定计划再执行",
    keywords: ["plan", "规划"],
  },
  {
    id: "search",
    title: "联网搜索",
    description: "启用实时网页检索",
    keywords: ["search", "web", "搜索"],
  },
  {
    id: "image",
    title: "生成图片",
    description: "根据描述生成图片",
    keywords: ["image", "图片", "画图"],
  },
];

function filterCommands(list: PromptSlashCommand[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return list;
  }
  return list.filter((command) =>
    [command.title, command.description ?? "", command.id, ...(command.keywords ?? [])]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

/**
 * `/` slash command. A picked command runs its own `run` when present,
 * otherwise the host's `onCommand` fallback owns the behaviour. The `/query`
 * text is always removed first — a command triggers an action, it is not a
 * persisted token like a mention.
 */
export function buildSlashExtension(options: {
  getSource: () => PromptSlashSource | undefined;
  getOnSkillsLoad: () => PromptSkillsLoad | undefined;
  getApi: () => PromptInputApi | null;
  onCommand: (command: PromptSlashCommand, api: PromptInputApi) => void;
}) {
  return createSuggestionExtension<PromptSlashCommand>({
    name: "promptSlash",
    char: "/",
    pluginKey: slashPluginKey,
    allowSpaces: false,
    emptyLabel: "没有可用技能（请在智能体设置中启用技能）",
    items: async (query, signal) => {
      const onSkillsLoad = options.getOnSkillsLoad();
      if (onSkillsLoad) {
        const loaded = await onSkillsLoad(signal);
        if (signal.aborted) {
          return [];
        }
        return filterCommands(loaded, query);
      }
      const source = options.getSource() ?? DEFAULT_SLASH_COMMANDS;
      const list = typeof source === "function" ? source(query) : source;
      return filterCommands(list, query);
    },
    getItemKey: (command) => command.id,
    renderItem: (command) => (
      <>
        <span className="prompt-input-suggestion-icon">{command.icon ?? <Sparkles className="size-4" />}</span>
        <span className="prompt-input-suggestion-text">
          <span className="prompt-input-suggestion-label">{command.title}</span>
          {command.description ? <span className="prompt-input-suggestion-desc">{command.description}</span> : null}
        </span>
      </>
    ),
    onSelect: (editor, range, command) => {
      editor.chain().focus().deleteRange(range).run();
      const api = options.getApi();
      if (!api) {
        return;
      }
      if (command.run) {
        command.run(api);
        return;
      }
      options.onCommand(command, api);
    },
  });
}

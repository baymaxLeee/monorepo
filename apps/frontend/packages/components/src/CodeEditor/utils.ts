import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import type { Extension } from "@codemirror/state";
import { slotClassNameFactory } from "../compat/className";

export const codeEditorClass = slotClassNameFactory("code-editor");

const LANG_MAP: Record<string, () => Extension> = {
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  json: () => json(),
  html: () => html(),
  xml: () => xml(),
  yaml: () => yaml(),
  yml: () => yaml(),
  md: () => markdown(),
  py: () => python(),
  sh: () => StreamLanguage.define(shell),
  bash: () => StreamLanguage.define(shell),
};

export function getLanguageExtension(
  fileName: string,
  langMapExtensions: Record<string, () => Extension> = {},
): Extension | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!ext) return null;

  if (ext in langMapExtensions) {
    return langMapExtensions[ext]() || null;
  }

  if (ext in LANG_MAP) {
    return LANG_MAP[ext]();
  }

  return null;
}

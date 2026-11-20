import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { defineAgentTool } from "./manifest.js";
import { normalizeToolIssue, toolCompleted, toolFailed, toolPartial } from "./outcome.js";

export interface PatchHunkLine {
  type: "context" | "add" | "remove";
  text: string;
}
export interface PatchHunk {
  changeContext?: string;
  lines: PatchHunkLine[];
}
export type ApplyPatchAction =
  | { type: "add"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; moveTo?: string; hunks: PatchHunk[] };
export interface ParsedApplyPatch {
  actions: ApplyPatchAction[];
  paths: string[];
}

function patchPath(value: string): string {
  const path = value.trim();
  if (!path || path.includes("\0") || path === "/dev/null") throw new Error("apply_patch contains an invalid path");
  return path;
}

export function parseApplyPatch(patch: string): ParsedApplyPatch {
  const lines = patch.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "*** Begin Patch") throw new Error("apply_patch must start with *** Begin Patch");
  let index = 1;
  const actions: ApplyPatchAction[] = [];
  const paths: string[] = [];
  const used = new Set<string>();
  const recordPath = (path: string) => {
    if (used.has(path)) throw new Error(`apply_patch path appears more than once: ${path}`);
    used.add(path);
    paths.push(path);
  };
  while (index < lines.length && lines[index] !== "*** End Patch") {
    const header = lines[index++]!;
    if (header.startsWith("*** Add File: ")) {
      const path = patchPath(header.slice("*** Add File: ".length));
      recordPath(path);
      const content: string[] = [];
      while (index < lines.length && !lines[index]!.startsWith("*** ")) {
        const line = lines[index++]!;
        if (!line.startsWith("+")) throw new Error(`added file lines must start with +: ${path}`);
        content.push(line.slice(1));
      }
      actions.push({ type: "add", path, content: content.length > 0 ? `${content.join("\n")}\n` : "" });
      continue;
    }
    if (header.startsWith("*** Delete File: ")) {
      const path = patchPath(header.slice("*** Delete File: ".length));
      recordPath(path);
      actions.push({ type: "delete", path });
      continue;
    }
    if (header.startsWith("*** Update File: ")) {
      const path = patchPath(header.slice("*** Update File: ".length));
      recordPath(path);
      let moveTo: string | undefined;
      if (lines[index]?.startsWith("*** Move to: ")) {
        moveTo = patchPath(lines[index++]!.slice("*** Move to: ".length));
        recordPath(moveTo);
      }
      const hunks: PatchHunk[] = [];
      while (index < lines.length && !lines[index]!.startsWith("*** ")) {
        const marker = lines[index]!;
        if (marker !== "@@" && !marker.startsWith("@@ ")) {
          throw new Error(`update file hunk must start with @@: ${path}`);
        }
        const changeContext = marker === "@@" ? undefined : marker.slice("@@ ".length);
        index++;
        const hunkLines: PatchHunkLine[] = [];
        while (index < lines.length && !lines[index]!.startsWith("@@") && !lines[index]!.startsWith("*** ")) {
          const line = lines[index++]!;
          const prefix = line[0];
          if (prefix !== " " && prefix !== "+" && prefix !== "-") {
            throw new Error(`patch hunk line must start with space, +, or -: ${path}`);
          }
          hunkLines.push({ type: prefix === " " ? "context" : prefix === "+" ? "add" : "remove", text: line.slice(1) });
        }
        if (hunkLines.length === 0 || !hunkLines.some((line) => line.type !== "context")) {
          throw new Error(`patch hunk must contain a change: ${path}`);
        }
        hunks.push({ ...(changeContext !== undefined ? { changeContext } : {}), lines: hunkLines });
      }
      if (hunks.length === 0 && !moveTo) throw new Error(`update file has no hunks: ${path}`);
      actions.push({ type: "update", path, ...(moveTo ? { moveTo } : {}), hunks });
      continue;
    }
    throw new Error(`unexpected apply_patch line: ${header}`);
  }
  if (lines[index] !== "*** End Patch") throw new Error("apply_patch must end with *** End Patch");
  if (lines.slice(index + 1).some((line) => line !== ""))
    throw new Error("apply_patch has content after *** End Patch");
  if (actions.length === 0) throw new Error("apply_patch contains no file changes");
  return { actions, paths };
}

type LineEnding = "\n" | "\r\n" | "\r";

interface SourceLine {
  text: string;
  ending?: LineEnding;
}

interface ParsedText {
  bom: string;
  lines: SourceLine[];
  preferredEnding: LineEnding;
  finalNewline: boolean;
}

interface LineReplacement {
  start: number;
  oldLength: number;
  newLines: string[];
}

function splitText(content: string): ParsedText {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = bom ? content.slice(1) : content;
  const lines: SourceLine[] = [];
  let preferredEnding: LineEnding | undefined;
  let lineStart = 0;
  let cursor = 0;
  while (cursor < body.length) {
    let ending: LineEnding | undefined;
    let endingLength = 0;
    if (body[cursor] === "\r") {
      ending = body[cursor + 1] === "\n" ? "\r\n" : "\r";
      endingLength = ending.length;
    } else if (body[cursor] === "\n") {
      ending = "\n";
      endingLength = 1;
    }
    if (!ending) {
      cursor++;
      continue;
    }
    preferredEnding ??= ending;
    lines.push({ text: body.slice(lineStart, cursor), ending });
    cursor += endingLength;
    lineStart = cursor;
  }
  if (lineStart < body.length) lines.push({ text: body.slice(lineStart) });
  return {
    bom,
    lines,
    preferredEnding: preferredEnding ?? "\n",
    finalNewline: lines.at(-1)?.ending !== undefined,
  };
}

function matchesAt(lines: string[], expected: string[], index: number, mode: "exact" | "rstrip" | "trim"): boolean {
  if (index + expected.length > lines.length) return false;
  const normalize =
    mode === "exact"
      ? (value: string) => value
      : mode === "rstrip"
        ? (value: string) => value.trimEnd()
        : (value: string) => value.trim();
  return expected.every((line, offset) => normalize(lines[index + offset]!) === normalize(line));
}

function findUniqueMatch(lines: string[], expected: string[], start: number): number {
  for (const mode of ["exact", "rstrip", "trim"] as const) {
    const matches: number[] = [];
    for (let index = start; index <= lines.length - expected.length; index++) {
      if (matchesAt(lines, expected, index, mode)) matches.push(index);
    }
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1)
      throw new Error("apply_patch context matches more than once; include more unchanged context");
  }
  throw new Error("apply_patch context was not found; reread the file and regenerate the patch");
}

function findFirstMatch(lines: string[], expected: string[], start: number): number {
  for (const mode of ["exact", "rstrip", "trim"] as const) {
    for (let index = start; index <= lines.length - expected.length; index++) {
      if (matchesAt(lines, expected, index, mode)) return index;
    }
  }
  throw new Error("apply_patch context was not found; reread the file and regenerate the patch");
}

function replacementsForHunk(hunk: PatchHunk, start: number): LineReplacement[] {
  const replacements: LineReplacement[] = [];
  let sourceOffset = 0;
  let replacementStart: number | undefined;
  let oldLength = 0;
  let newLines: string[] = [];
  const flush = () => {
    if (replacementStart === undefined) return;
    replacements.push({ start: start + replacementStart, oldLength, newLines });
    replacementStart = undefined;
    oldLength = 0;
    newLines = [];
  };
  for (const line of hunk.lines) {
    if (line.type === "context") {
      flush();
      sourceOffset++;
      continue;
    }
    replacementStart ??= sourceOffset;
    if (line.type === "remove") {
      oldLength++;
      sourceOffset++;
    } else {
      newLines.push(line.text);
    }
  }
  flush();
  return replacements;
}

function applyReplacements(source: ParsedText, replacements: LineReplacement[]): string {
  const result: SourceLine[] = [];
  let sourceIndex = 0;
  for (const replacement of replacements) {
    if (replacement.start < sourceIndex) throw new Error("apply_patch hunks overlap or are out of order");
    result.push(...source.lines.slice(sourceIndex, replacement.start));
    result.push(...replacement.newLines.map((text) => ({ text, ending: source.preferredEnding })));
    sourceIndex = replacement.start + replacement.oldLength;
  }
  result.push(...source.lines.slice(sourceIndex));

  for (const line of result.slice(0, -1)) line.ending ??= source.preferredEnding;
  const finalLine = result.at(-1);
  if (finalLine) {
    if (source.finalNewline) finalLine.ending ??= source.preferredEnding;
    else delete finalLine.ending;
  }
  return `${source.bom}${result.map((line) => `${line.text}${line.ending ?? ""}`).join("")}`;
}

export function applyPatchToText(content: string, action: Extract<ApplyPatchAction, { type: "update" }>): string {
  const source = splitText(content);
  const originalLines = source.lines.map((line) => line.text);
  const replacements: LineReplacement[] = [];
  let cursor = 0;
  let positioned = false;
  for (const hunk of action.hunks) {
    if (hunk.changeContext !== undefined) {
      cursor = findFirstMatch(originalLines, [hunk.changeContext], cursor) + 1;
      positioned = true;
    }
    const before = hunk.lines.filter((line) => line.type !== "add").map((line) => line.text);
    const matchStart =
      before.length === 0
        ? hunk.changeContext !== undefined
          ? cursor
          : originalLines.length
        : positioned
          ? findFirstMatch(originalLines, before, cursor)
          : findUniqueMatch(originalLines, before, cursor);
    replacements.push(...replacementsForHunk(hunk, matchStart));
    cursor = matchStart + before.length;
    positioned = true;
  }
  replacements.sort((left, right) => left.start - right.start);
  return applyReplacements(source, replacements);
}

export interface AppliedFileChange {
  type: "add" | "update" | "delete";
  path: string;
  sha256?: string;
  before_sha256?: string;
}
export interface ApplyPatchResult {
  changes: AppliedFileChange[];
}

export const applyPatchInputSchema = z.object({
  patch: z
    .string()
    .min(1)
    .max(1024 * 1024)
    .describe("Codex-style patch bounded by *** Begin Patch and *** End Patch."),
});
export type ApplyPatchInput = z.infer<typeof applyPatchInputSchema>;

export function createApplyPatchTool(
  run: (input: ApplyPatchInput, options: ToolExecutionOptions<unknown>) => Promise<ApplyPatchResult>,
) {
  return defineAgentTool(
    "apply_patch",
    tool({
      description:
        "Apply a validated Codex-style patch to UTF-8 workspace files. Supports add, update, delete, and move. The entire patch and every source/destination path are validated before execution. Multi-file changes are not transactional; a failure reports exact committed changes.",
      inputSchema: applyPatchInputSchema,
      execute: async (input, options) => {
        try {
          const result = await run(input, options);
          return toolCompleted(result);
        } catch (error) {
          const changes =
            error && typeof error === "object" && "changes" in error
              ? (error as { changes: AppliedFileChange[] }).changes
              : [];
          const issue = normalizeToolIssue(error, { source: "apply_patch" });
          return changes.length > 0 ? toolPartial({ changes }, issue) : toolFailed(issue);
        }
      },
    }),
    { capability: "files", effect: "write", trust: "private-untrusted", execution: "inline" },
    {
      summary: "Apply targeted multi-file text changes with path preflight and partial-commit reporting.",
      prerequisites: ["Read relevant existing files before constructing update or delete actions."],
      constraints: ["Use write_file for a large complete-file replacement."],
    },
  );
}

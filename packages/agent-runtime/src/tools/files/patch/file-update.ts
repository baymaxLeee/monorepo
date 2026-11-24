import type { ApplyPatchAction, PatchHunk } from "./parser.js";
import { seekSequence } from "./seek-sequence.js";

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
  for (const hunk of action.hunks) {
    if (hunk.changeContext !== undefined) {
      cursor = seekSequence(originalLines, [hunk.changeContext], cursor) + 1;
    }
    const before = hunk.lines.filter((line) => line.type !== "add").map((line) => line.text);
    if (!before.length) {
      replacements.push(...replacementsForHunk(hunk, originalLines.length));
      continue;
    }
    let lines = hunk.lines;
    let matchStart: number;
    try {
      matchStart = seekSequence(originalLines, before, cursor, hunk.endOfFile);
    } catch (error) {
      if (before.at(-1) !== "") throw error;
      before.pop();
      matchStart = seekSequence(originalLines, before, cursor, hunk.endOfFile);
      // Drop the final empty sentinel independently on the old and new sides.
      const lastOld = lines.map((line) => line.type !== "add").lastIndexOf(true);
      const lastNew = lines.map((line) => line.type !== "remove").lastIndexOf(true);
      lines = lines.flatMap((line, index) => {
        const old = index !== lastOld && line.type !== "add";
        const next = !(index === lastNew && line.text === "") && line.type !== "remove";
        return old || next ? [{ ...line, type: old && next ? "context" : old ? "remove" : "add" }] : [];
      });
    }
    replacements.push(...replacementsForHunk({ ...hunk, lines }, matchStart));
    cursor = matchStart + before.length;
  }
  replacements.sort((left, right) => left.start - right.start);
  return applyReplacements(source, replacements);
}

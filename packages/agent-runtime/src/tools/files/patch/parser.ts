export interface PatchHunkLine {
  type: "context" | "add" | "remove";
  text: string;
}
export interface PatchHunk {
  changeContext?: string;
  endOfFile?: boolean;
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
    if (used.has(path)) return;
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
        const hasHeader = marker === "@@" || marker.startsWith("@@ ");
        if (!hasHeader && hunks.length > 0) {
          throw new Error(`update file hunk must start with @@: ${path}`);
        }
        const changeContext = marker.startsWith("@@ ") ? marker.slice(3) : undefined;
        if (hasHeader) index++;
        const hunkLines: PatchHunkLine[] = [];
        while (index < lines.length && !lines[index]!.startsWith("@@") && !lines[index]!.startsWith("*** ")) {
          const line = lines[index++]!;
          const prefix = line[0] ?? " ";
          if (prefix !== " " && prefix !== "+" && prefix !== "-") {
            throw new Error(`patch hunk line must start with space, +, or -: ${path}`);
          }
          hunkLines.push({ type: prefix === " " ? "context" : prefix === "+" ? "add" : "remove", text: line.slice(1) });
        }
        const endOfFile = lines[index] === "*** End of File";
        if (endOfFile) index++;
        if (hunkLines.length === 0 || !hunkLines.some((line) => line.type !== "context")) {
          throw new Error(`patch hunk must contain a change: ${path}`);
        }
        hunks.push({
          ...(changeContext !== undefined ? { changeContext } : {}),
          ...(endOfFile ? { endOfFile } : {}),
          lines: hunkLines,
        });
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

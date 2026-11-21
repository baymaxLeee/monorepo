import { getToolName, isToolUIPart, tool, type UIMessage } from "ai";
import { z } from "zod";

import type { SkillListing } from "../context/instructions/index.js";
import { defineAgentTool } from "./manifest.js";
import { ToolBlockedError, toolOutcomeData } from "./outcome.js";
import type { AgentToolManifest } from "./types.js";

export type SkillFileResource =
  | { storageKind: "inline"; mimeType: string | null; content: string }
  | {
      storageKind: "asset";
      mimeType: string | null;
      assetId: string;
      revisionId: string;
      sizeBytes: number;
      sha256: string;
      url: string;
    };

export interface SkillSourceEntry {
  id: string;
  name: string;
  description: string;
  loadBody: () => Promise<string>;
  loadFile?: (path: string) => Promise<SkillFileResource>;
}

/** Per-run skill source: L1 listings plus host-owned, on-demand immutable loaders. */
export interface SkillSource {
  skills: SkillSourceEntry[];
  activeSkillName?: string | null;
}

/** Recover the single selected skill from the host's journal on an approval continuation. */
export function continuedSkillName(message: UIMessage | undefined): string | null {
  let loaded: string | null = null;
  if (message?.role !== "assistant") return null;
  for (const part of message.parts) {
    if (
      !isToolUIPart(part) ||
      getToolName(part) !== "load_skill" ||
      part.state !== "output-available" ||
      part.preliminary
    )
      continue;
    const output = toolOutcomeData(part.output);
    if (!output || typeof output !== "object" || !("name" in output) || typeof output.name !== "string" || !output.name)
      continue;
    if (loaded && loaded !== output.name) throw new Error("client continuation contains multiple loaded skills");
    loaded = output.name;
  }
  return loaded;
}

const loadSkillOutputSchema = z.object({
  name: z.string(),
  instructions: z.string(),
});

/**
 * Resolves the skills a run advertises and the single `load_skill` tool that
 * pulls their bodies. `load_skill` refuses any name not in the advertised set,
 * so the model can only load published, enabled workspace skills.
 */
export function resolveSkills(source?: SkillSource | null): {
  manifests: AgentToolManifest[];
  skills: SkillListing[];
} {
  const loaders = new Map<string, () => Promise<string>>();
  const fileLoaders = new Map<string, (path: string) => Promise<SkillFileResource>>();
  const listings = new Map<string, SkillListing>();
  let loadedSkillName = source?.activeSkillName ?? null;
  let skillLoadPending = false;

  for (const skill of source?.skills ?? []) {
    if (loaders.has(skill.name)) {
      throw new Error(`duplicate advertised skill name: ${skill.name}`);
    }
    loaders.set(skill.name, skill.loadBody);
    if (skill.loadFile) {
      fileLoaders.set(skill.name, skill.loadFile);
    }
    listings.set(skill.name, { name: skill.name, description: skill.description });
  }

  if (loaders.size === 0) {
    return { manifests: [], skills: [] };
  }

  const manifests: AgentToolManifest[] = [];
  const loadSkill = defineAgentTool(
    "load_skill",
    tool({
      description:
        "Load the full instructions for one skill listed in <available_skills>. At most one skill may be loaded per logical turn. Call this as the only tool in the current step, observe its result, then follow the loaded instructions in the next step.",
      inputSchema: z.object({ name: z.string().min(1) }),
      outputSchema: loadSkillOutputSchema,
      execute: async ({ name }) => {
        if (loadedSkillName || skillLoadPending) {
          throw new ToolBlockedError({
            code: "SKILL_ALREADY_LOADED",
            message: `a skill is already loaded in this logical turn: ${loadedSkillName ?? "pending"}`,
            retryable: false,
            source: "skill",
          });
        }
        const loader = loaders.get(name);
        if (!loader) {
          throw new ToolBlockedError({
            code: "SKILL_NOT_AVAILABLE",
            message: `unknown skill: ${name}`,
            retryable: false,
            source: "skill",
          });
        }
        skillLoadPending = true;
        try {
          const instructions = await loader();
          loadedSkillName = name;
          return { name, instructions };
        } finally {
          skillLoadPending = false;
        }
      },
      toModelOutput: ({ output }) => ({
        type: "text",
        value: `<loaded_skill name="${output.name}">\n${output.instructions}\n</loaded_skill>`,
      }),
    }),
    {
      capability: "external",
      effect: "read",
      trust: "closed",
      execution: "inline",
      source: "skill",
    },
    {
      summary: "Load detailed instructions for a matching skill on demand.",
      constraints: [
        "Load only skills advertised in <available_skills>.",
        "Load at most one skill per logical turn.",
        "Call alone, then observe the instructions before choosing downstream actions.",
      ],
      parallelizable: false,
    },
  );
  if (!loadedSkillName) {
    manifests.push(loadSkill);
  }

  const readSkillFile = defineAgentTool(
    "read_skill_file",
    tool({
      description:
        "Read one relative file from the currently loaded skill. Use only when SKILL.md requires that resource.",
      inputSchema: z.object({
        name: z.string().min(1),
        path: z.string().min(1).max(1024),
      }),
      outputSchema: z.discriminatedUnion("storageKind", [
        z.object({
          name: z.string(),
          path: z.string(),
          storageKind: z.literal("inline"),
          mimeType: z.string().nullable(),
          content: z.string(),
        }),
        z.object({
          name: z.string(),
          path: z.string(),
          storageKind: z.literal("asset"),
          mimeType: z.string().nullable(),
          assetId: z.string(),
          revisionId: z.string(),
          sizeBytes: z.number().int().nonnegative(),
          sha256: z.string(),
          url: z.string(),
        }),
      ]),
      execute: async ({ name, path }) => {
        if (name !== loadedSkillName) {
          throw new ToolBlockedError({
            code: "SKILL_NOT_ACTIVE",
            message: `skill is not active in this logical turn: ${name}`,
            retryable: false,
            source: "skill",
          });
        }
        const loader = fileLoaders.get(name);
        if (!loader) {
          throw new ToolBlockedError({
            code: "SKILL_FILE_NOT_AVAILABLE",
            message: `skill has no readable files: ${name}`,
            retryable: false,
            source: "skill",
          });
        }
        return { name, path, ...(await loader(path)) };
      },
      toModelOutput: ({ output }) =>
        output.storageKind === "inline"
          ? {
              type: "text",
              value: `<skill_file>\nName: ${output.name}\nPath: ${JSON.stringify(output.path)}\n${output.content}\n</skill_file>`,
            }
          : {
              type: "text",
              value: `<skill_file_asset>\n${JSON.stringify(output)}\n</skill_file_asset>`,
            },
    }),
    {
      capability: "external",
      effect: "read",
      trust: "closed",
      execution: "inline",
      source: "skill",
    },
    {
      summary: "Read one resource from a loaded Skill package.",
      constraints: ["Read only paths advertised by the loaded Skill."],
      parallelizable: true,
    },
  );
  if (fileLoaders.size > 0) {
    manifests.push(readSkillFile);
  }

  return {
    manifests,
    skills: loadedSkillName ? [] : [...listings.values()],
  };
}

import { tool } from "ai";
import { z } from "zod";

import type { SkillListing } from "../../context/instructions/index.js";
import { defineAgentTool } from "../../tools/manifest.js";
import { ToolBlockedError } from "../../tools/outcome.js";
import type { AgentToolManifest } from "../../tools/types.js";

/** Per-run admin (bot-bound) skill source: L1 listings + an on-demand body
 *  loader keyed by skill id. */
export interface AdminSkillSource {
  skills: { id: string; name: string; description: string }[];
  activeSkillName?: string | null;
  loadBody: (skillId: string) => Promise<string>;
  loadFile?: (skillId: string, path: string) => Promise<string>;
}

const loadSkillOutputSchema = z.object({
  name: z.string(),
  instructions: z.string(),
});

/**
 * Resolves the skills a run advertises and the single `load_skill` tool that
 * pulls their bodies. `load_skill` refuses any name not in the advertised set,
 * so the model can only load published, enabled skills bound to this bot.
 */
export function resolveSkills(adminSource?: AdminSkillSource | null): {
  manifests: AgentToolManifest[];
  skills: SkillListing[];
} {
  const loaders = new Map<string, () => Promise<string>>();
  const fileLoaders = new Map<string, (path: string) => Promise<string>>();
  const listings = new Map<string, SkillListing>();
  let loadedSkillName = adminSource?.activeSkillName ?? null;
  let skillLoadPending = false;

  for (const skill of adminSource?.skills ?? []) {
    loaders.set(skill.name, () => adminSource!.loadBody(skill.id));
    if (adminSource?.loadFile) {
      fileLoaders.set(skill.name, (path) => adminSource.loadFile!(skill.id, path));
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
      inputSchema: z.object({ name: z.string().min(1).max(64) }),
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
      modes: ["normal", "plan"],
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
        "Read one relative file listed by a loaded admin-managed skill. Use only when SKILL.md requires that resource.",
      inputSchema: z.object({
        name: z.string().min(1).max(64),
        path: z.string().min(1).max(1024),
      }),
      outputSchema: z.object({ name: z.string(), path: z.string(), content: z.string() }),
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
        return { name, path, content: await loader(path) };
      },
      toModelOutput: ({ output }) => ({
        type: "text",
        value: `<skill_file>\nName: ${output.name}\nPath: ${JSON.stringify(output.path)}\n${output.content}\n</skill_file>`,
      }),
    }),
    {
      capability: "external",
      effect: "read",
      trust: "closed",
      execution: "inline",
      modes: ["normal", "plan"],
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

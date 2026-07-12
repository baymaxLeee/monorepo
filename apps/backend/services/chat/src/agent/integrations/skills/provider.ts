import { tool } from "ai";
import { z } from "zod";

import type { SkillListing } from "../../context/instructions/index.js";
import { defineAgentTool } from "../../tools/manifest.js";
import type { AgentToolManifest } from "../../tools/types.js";

/** Per-run admin (bot-bound) skill source: L1 listings + an on-demand body
 *  loader keyed by skill id. */
export interface AdminSkillSource {
  skills: { id: string; name: string; description: string }[];
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
export function resolveSkills(
  adminSource?: AdminSkillSource | null,
): { manifests: AgentToolManifest[]; skills: SkillListing[] } {
  const loaders = new Map<string, () => Promise<string>>();
  const fileLoaders = new Map<string, (path: string) => Promise<string>>();
  const listings = new Map<string, SkillListing>();

  for (const skill of adminSource?.skills ?? []) {
    loaders.set(skill.name, () => adminSource!.loadBody(skill.id));
    if (adminSource?.loadFile) {
      fileLoaders.set(skill.name, (path) => adminSource.loadFile!(skill.id, path));
    }
    listings.set(skill.name, { name: skill.name, description: skill.description });
  }

  if (loaders.size === 0) return { manifests: [], skills: [] };

  const loadSkill = defineAgentTool(
    "load_skill",
    tool({
      description:
        "Load the full instructions for one skill listed in <available_skills>. Call this before following a matching skill workflow.",
      inputSchema: z.object({ name: z.string().min(1).max(64) }),
      outputSchema: loadSkillOutputSchema,
      execute: async ({ name }) => {
        const loader = loaders.get(name);
        if (!loader) throw new Error(`unknown skill: ${name}`);
        return { name, instructions: await loader() };
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
      constraints: ["Load only skills advertised in <available_skills>."],
      parallelizable: false,
    },
  );

  if (fileLoaders.size === 0) {
    return { manifests: [loadSkill], skills: [...listings.values()] };
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
        const loader = fileLoaders.get(name);
        if (!loader) throw new Error(`skill has no readable files: ${name}`);
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

  return { manifests: [loadSkill, readSkillFile], skills: [...listings.values()] };
}

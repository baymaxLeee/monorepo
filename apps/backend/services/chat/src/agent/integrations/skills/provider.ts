import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { tool } from "ai";
import { z } from "zod";

import type { AgentMode } from "../../agents/types.js";
import type { SkillListing } from "../../context/instructions/index.js";
import { defineAgentTool } from "../../tools/manifest.js";
import type { AgentToolManifest } from "../../tools/types.js";

interface SystemSkill {
  name: string;
  description: string;
  resource: URL;
}

const SKILL_RESOURCES: URL[] = [new URL("./field-support/SKILL.md", import.meta.url)];

// YAML frontmatter is the Skill's single source of truth for name/description (matches
// the Agent Skills spec: https://anthropics-skills.mintlify.app/spec/overview). Values are
// flat one-line strings, so a small anchored regex avoids pulling in a YAML parser.
function parseSkillFrontmatter(raw: string, resource: URL): { name: string; description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`skill file is missing YAML frontmatter: ${resource}`);
  const [, frontmatter, body] = match;
  const name = /^name:\s*(.+?)\s*$/m.exec(frontmatter)?.[1];
  const description = /^description:\s*(.+?)\s*$/m.exec(frontmatter)?.[1];
  if (!name || !description) {
    throw new Error(`skill frontmatter must declare name and description: ${resource}`);
  }
  return { name, description, body: body.trim() };
}

const SYSTEM_SKILLS: SystemSkill[] = SKILL_RESOURCES.map((resource) => {
  const { name, description } = parseSkillFrontmatter(readFileSync(resource, "utf8"), resource);
  return { name, description, resource };
});

/** Names owned by code-governed system skills. Admin (bot-bound) skills may not
 *  use these — a tenant must never shadow a built-in workflow/safety skill. The
 *  run filters admin skills against this set before advertising or activating. */
export const SYSTEM_SKILL_NAMES: ReadonlySet<string> = new Set(SYSTEM_SKILLS.map((s) => s.name));

/** Per-run admin (bot-bound) skill source: L1 listings + an on-demand body
 *  loader keyed by skill id. Threaded from the run orchestrator so the single
 *  `load_skill` tool can resolve both built-in and configured skills. */
export interface AdminSkillSource {
  skills: { id: string; name: string; description: string }[];
  loadBody: (skillId: string) => Promise<string>;
  loadFile?: (skillId: string, path: string) => Promise<string>;
}

const loadSkillOutputSchema = z.object({
  name: z.string(),
  instructions: z.string(),
});

async function loadSystemSkillBody(skill: SystemSkill): Promise<string> {
  const raw = await readFile(skill.resource, "utf8");
  return parseSkillFrontmatter(raw, skill.resource).body;
}

/**
 * Resolves the skills a run advertises and the single `load_skill` tool that
 * pulls their bodies. System skills (filesystem) and admin skills (bot-bound,
 * loaded via admin) are merged by name; on a name collision the code-governed
 * system skill wins and the admin skill is dropped, so tenant config can never
 * shadow a built-in workflow/safety skill. `load_skill` refuses any name not in
 * the advertised set, so the model can only load skills this bot actually offers.
 */
export function resolveSkills(
  mode: AgentMode,
  adminSource?: AdminSkillSource | null,
): { manifests: AgentToolManifest[]; skills: SkillListing[] } {
  if (mode !== "normal") return { manifests: [], skills: [] };

  // name -> body loader. System skills claim their names first and are never
  // overridden; a colliding admin skill is skipped (see SYSTEM_SKILL_NAMES).
  const loaders = new Map<string, () => Promise<string>>();
  const fileLoaders = new Map<string, (path: string) => Promise<string>>();
  const listings = new Map<string, SkillListing>();

  for (const skill of SYSTEM_SKILLS) {
    loaders.set(skill.name, () => loadSystemSkillBody(skill));
    listings.set(skill.name, { name: skill.name, description: skill.description });
  }
  for (const skill of adminSource?.skills ?? []) {
    if (loaders.has(skill.name)) {
      console.warn(
        `[chat-agent] ignoring bot skill "${skill.name}": name is reserved by a built-in system skill`,
      );
      continue;
    }
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
      modes: ["normal"],
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
      modes: ["normal"],
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

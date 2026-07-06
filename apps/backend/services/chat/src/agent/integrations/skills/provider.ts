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

const loadSkillOutputSchema = z.object({
  name: z.string(),
  instructions: z.string(),
});

async function loadSystemSkill(name: string): Promise<z.infer<typeof loadSkillOutputSchema>> {
  const skill = SYSTEM_SKILLS.find((candidate) => candidate.name === name);
  if (!skill) throw new Error(`unknown system skill: ${name}`);
  const raw = await readFile(skill.resource, "utf8");
  return { name: skill.name, instructions: parseSkillFrontmatter(raw, skill.resource).body };
}

export function resolveSystemSkills(mode: AgentMode): {
  manifests: AgentToolManifest[];
  skills: SkillListing[];
} {
  if (mode !== "normal") return { manifests: [], skills: [] };

  return {
    skills: SYSTEM_SKILLS.map((skill) => ({ name: skill.name, description: skill.description })),
    manifests: [
      defineAgentTool(
        "load_skill",
        tool({
          description:
            "Load the full instructions for one system skill listed in <available_skills>. Call this before following a matching skill workflow.",
          inputSchema: z.object({
            name: z.string().min(1).max(100),
          }),
          outputSchema: loadSkillOutputSchema,
          execute: ({ name }) => loadSystemSkill(name),
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
          summary: "Load detailed instructions for a matching system skill on demand.",
          constraints: ["Load only skills advertised in <available_skills>."],
          parallelizable: false,
        },
      ),
    ],
  };
}

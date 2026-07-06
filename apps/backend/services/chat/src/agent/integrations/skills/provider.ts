import { readFile } from "node:fs/promises";

import { tool } from "ai";
import { z } from "zod";

import type { AgentMode } from "../../agents/types.js";
import { defineAgentTool } from "../../tools/manifest.js";
import type { AgentToolManifest } from "../../tools/types.js";

interface SystemSkill {
  name: string;
  description: string;
  resource: URL;
}

const SYSTEM_SKILLS: SystemSkill[] = [
  {
    name: "field-support",
    description:
      "Diagnose B2B customer product problems with structured intake, team-knowledge evidence, troubleshooting, and engineering handoff.",
    resource: new URL("./field-support/SKILL.md", import.meta.url),
  },
];

const loadSkillOutputSchema = z.object({
  name: z.string(),
  instructions: z.string(),
});

function availableSkillsInstruction(): string {
  return [
    "<available_skills>",
    "Load a skill before substantive work when the user's request clearly matches its description. Do not load skills for unrelated requests.",
    ...SYSTEM_SKILLS.map((skill) => `- ${skill.name}: ${skill.description}`),
    "</available_skills>",
  ].join("\n");
}

async function loadSystemSkill(name: string): Promise<z.infer<typeof loadSkillOutputSchema>> {
  const skill = SYSTEM_SKILLS.find((candidate) => candidate.name === name);
  if (!skill) throw new Error(`unknown system skill: ${name}`);
  return { name: skill.name, instructions: await readFile(skill.resource, "utf8") };
}

export function resolveSystemSkills(mode: AgentMode): {
  manifests: AgentToolManifest[];
  instructions: string[];
} {
  if (mode !== "normal") return { manifests: [], instructions: [] };

  return {
    instructions: [availableSkillsInstruction()],
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

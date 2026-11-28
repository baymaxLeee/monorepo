import { createHash } from "node:crypto";

import { renderExecutionEnvironment, type ExecutionEnvironment } from "../environment.js";
import { renderMemory } from "./context-data.js";
import { CORE_POLICY } from "./core-policy.js";
import { INSTRUCTION_SECTION_TAGS } from "./section-tags.js";
import type { InstructionContributions, InstructionInput, SkillListing } from "./types.js";
import { escapeXmlText, xmlSection } from "./xml.js";

export type InstructionSectionKind = "base" | "policy" | "world-state";

export interface InstructionSection {
  id: string;
  kind: InstructionSectionKind;
  content: string;
}

export interface InstructionPlanInput {
  modelInstructions?: string | null;
  input: InstructionInput;
  contributions?: InstructionContributions;
  environment?: ExecutionEnvironment;
}

export interface InstructionPlanDelta {
  added: InstructionSection[];
  replaced: InstructionSection[];
  removed: string[];
}

function renderSkills(skills: SkillListing[] | null | undefined): string | null {
  if (!skills?.length) return null;
  const body = [
    "Skills available for on-demand loading. Follow the load_skill tool contract when one clearly matches the current request.",
    ...skills.map((skill) => `- ${escapeXmlText(skill.name)}: ${escapeXmlText(skill.description)}`),
  ].join("\n");
  return xmlSection(INSTRUCTION_SECTION_TAGS.availableSkills, body);
}

function renderTemporalEnvironment(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return xmlSection(
    INSTRUCTION_SECTION_TAGS.environment,
    [
      `Today's date is ${year}-${month}-${day} (${weekday}).`,
      "Your training data may be stale. Verify time-sensitive facts with the available research tools and treat this date as authoritative.",
    ].join("\n"),
  )!;
}

function section(id: string, kind: InstructionSectionKind, content: string | null | undefined) {
  return content ? ({ id, kind, content } satisfies InstructionSection) : null;
}

/** Immutable, ordered prompt plan. Stable base/policy sections precede dynamic
 * world state so changing Turn facts does not reorder the reusable prefix. */
export class InstructionPlan {
  readonly sections: readonly InstructionSection[];

  constructor(sections: readonly InstructionSection[]) {
    const ids = new Set<string>();
    for (const item of sections) {
      if (ids.has(item.id)) throw new Error(`duplicate instruction section ${item.id}`);
      ids.add(item.id);
    }
    this.sections = [...sections];
  }

  render(): string {
    return ["<agent_instructions>", ...this.sections.map(({ content }) => content), "</agent_instructions>"].join(
      "\n\n",
    );
  }

  digest(): string {
    return createHash("sha256").update(this.render()).digest("hex");
  }

  diff(previous: InstructionPlan): InstructionPlanDelta {
    const before = new Map(previous.sections.map((item) => [item.id, item]));
    const current = new Map(this.sections.map((item) => [item.id, item]));
    return {
      added: this.sections.filter((item) => !before.has(item.id)),
      replaced: this.sections.filter((item) => {
        const old = before.get(item.id);
        return old !== undefined && (old.content !== item.content || old.kind !== item.kind);
      }),
      removed: previous.sections.filter((item) => !current.has(item.id)).map(({ id }) => id),
    };
  }
}

export function buildInstructionPlan({
  modelInstructions,
  input,
  contributions = {},
  environment,
}: InstructionPlanInput): InstructionPlan {
  const sections = [
    section(
      "model",
      "base",
      modelInstructions?.trim() ? xmlSection("model_instructions", escapeXmlText(modelInstructions.trim())) : null,
    ),
    section("core-policy", "policy", xmlSection(INSTRUCTION_SECTION_TAGS.corePolicy, CORE_POLICY)),
    section("available-skills", "world-state", renderSkills(contributions.skills)),
    section(
      "activated-skill",
      "world-state",
      input.activatedSkill
        ? xmlSection(INSTRUCTION_SECTION_TAGS.activatedSkill, escapeXmlText(input.activatedSkill.body), {
            name: input.activatedSkill.name,
          })
        : null,
    ),
    section("memory", "world-state", renderMemory(input.memories)),
    section("temporal-environment", "world-state", renderTemporalEnvironment(input.now)),
    section("execution-environment", "world-state", environment ? renderExecutionEnvironment(environment) : null),
  ].filter((item): item is InstructionSection => item !== null);
  return new InstructionPlan(sections);
}

export function renderAvailableSkills(skills: SkillListing[] | null | undefined): string | null {
  return renderSkills(skills);
}

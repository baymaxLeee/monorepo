import { renderMemory } from "./context-data.js";
import { CORE_POLICY } from "./core-policy.js";
import { INSTRUCTION_SECTION_TAGS } from "./section-tags.js";
import { type InstructionContributions, type InstructionInput, type SkillListing } from "./types.js";
import { USER_UPDATES } from "./user-updates.js";
import { escapeXmlText, xmlSection } from "./xml.js";

/**
 * Stable run-level instructions only. Tool workflows live with tool definitions;
 * step facts enter the transcript through context events.
 */
export function assembleInstructions(input: InstructionInput, contributions: InstructionContributions = {}): string {
  const sections = [
    xmlSection(INSTRUCTION_SECTION_TAGS.corePolicy, CORE_POLICY),
    xmlSection(INSTRUCTION_SECTION_TAGS.userUpdates, USER_UPDATES),
    renderAvailableSkills(contributions.skills),
    input.activatedSkill
      ? xmlSection(INSTRUCTION_SECTION_TAGS.activatedSkill, escapeXmlText(input.activatedSkill.body), {
          name: input.activatedSkill.name,
        })
      : null,
    renderMemory(input.memories),
    renderEnvironment(input.now),
  ].filter((section): section is string => Boolean(section));

  return ["<agent_instructions>", ...sections, "</agent_instructions>"].join("\n\n");
}

/**
 * Advertises loadable skills. The renderer owns the markup and escapes every
 * skill's name/description; contributors supply structured `SkillListing`s only,
 * so no free-text can enter the model context through this channel.
 */
export function renderAvailableSkills(skills: SkillListing[] | null | undefined): string | null {
  if (!skills || skills.length === 0) {
    return null;
  }
  const body = [
    "Skills available for on-demand loading. Follow the load_skill tool contract when one clearly matches the current request.",
    ...skills.map((skill) => `- ${escapeXmlText(skill.name)}: ${escapeXmlText(skill.description)}`),
  ].join("\n");
  return xmlSection(INSTRUCTION_SECTION_TAGS.availableSkills, body);
}

function renderEnvironment(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const body = [
    `Today's date is ${year}-${month}-${day} (${weekday}).`,
    'Your training data has a cutoff and may be stale. For anything time-sensitive, rely on web_search and treat the date above as the authoritative "today" — never default to an earlier year such as 2025.',
  ].join("\n");
  // Non-null: body is always a non-empty constant-derived string.
  return xmlSection(INSTRUCTION_SECTION_TAGS.environment, body)!;
}

import { renderBotProfile } from "./bot-profile.js";
import { renderMemory } from "./context-data.js";
import { CORE_POLICY } from "./core-policy.js";
import { renderExecutionProtocol } from "./execution.js";
import { renderRuntimeContract } from "./runtime.js";
import { INSTRUCTION_SECTION_TAGS } from "./section-tags.js";
import { type InstructionContributions, type InstructionInput, type SkillListing } from "./types.js";
import { escapeXmlText, xmlSection } from "./xml.js";

/**
 * The single, fixed-order instruction assembler. Section order is code-owned and
 * cannot be reordered by callers. Trust flows top→bottom: code-owned policy and
 * runtime and execution protocol first, then code-generated capabilities and
 * available skills, configured bot_profile, data, and server facts.
 */
export function assembleInstructions(input: InstructionInput, contributions: InstructionContributions = {}): string {
  const sections = [
    xmlSection(INSTRUCTION_SECTION_TAGS.corePolicy, CORE_POLICY),
    renderRuntimeContract(input.mode),
    renderExecutionProtocol(),
    xmlSection(INSTRUCTION_SECTION_TAGS.capabilityContract, contributions.capabilities ?? null),
    renderAvailableSkills(contributions.skills),
    input.activatedSkill
      ? xmlSection(INSTRUCTION_SECTION_TAGS.activatedSkill, escapeXmlText(input.activatedSkill.body), {
          name: input.activatedSkill.name,
        })
      : null,
    renderBotProfile(input.botProfile),
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
function renderAvailableSkills(skills: SkillListing[] | null | undefined): string | null {
  if (!skills || skills.length === 0) {
    return null;
  }
  const body = [
    "Load one skill before substantive work when the user's request clearly matches its description. At most one Skill may be loaded in the current logical turn. A Skill loaded in an earlier logical turn is not active now; load it again before reading its files when the current request clearly needs it. The load_skill call must be the only tool call in that step: observe the loaded instructions before deciding any clarification or workflow action. Do not load skills for unrelated requests.",
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

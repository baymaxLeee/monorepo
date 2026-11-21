export interface MemoryDatum {
  id: string;
  category: string;
  confidence: number;
  content: string;
}

export interface ActivatedSkillInstruction {
  name: string;
  body: string;
}

/** Non-tool-derived inputs to the instruction assembler, gathered per run. */
export interface InstructionInput {
  memories: MemoryDatum[];
  activatedSkill?: ActivatedSkillInstruction | null;
  now?: Date;
}

/** A skill advertised to the model in `<available_skills>`. The renderer owns
 * the markup; a contributor only supplies the structured name/description, so it
 * can never inject raw system instructions through this channel. */
export interface SkillListing {
  name: string;
  description: string;
}

/** Structured run-level contributions; tool behavior remains in tool definitions. */
export interface InstructionContributions {
  skills?: SkillListing[];
}

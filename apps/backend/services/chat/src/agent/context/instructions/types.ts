import type { AgentMode } from "../../agents/types.js";

export const INSTRUCTION_SCHEMA_VERSION = "2";

export type BotTone = "professional" | "concise" | "friendly" | "empathetic";

/**
 * Structured, schema-bound bot identity — the only path for bot identity into
 * the prompt. Populated per run from admin's resolved agent (role/domain/
 * audience/tone); the free-text `system_prompt` chain has been removed. When a
 * field is null the renderer omits it; when all are null no `<bot_profile>` is emitted.
 */
export interface BotProfileSnapshot {
  name?: string | null;
  roleDescription?: string | null;
  domainDescription?: string | null;
  audience?: string | null;
  tone?: BotTone | null;
}

export interface MemoryDatum {
  id: string;
  category: string;
  confidence: number;
  content: string;
}

export interface ReferencedDocument {
  id: string;
  title: string;
  filename: string;
  kind: string;
}

/**
 * A projector-supplied context block, discriminated by `kind`. The renderer maps
 * each `kind` to a fixed tag (and fixed attribute set) and escapes every value —
 * callers cannot choose the tag/attrs or hand over pre-rendered XML, so
 * user/model-authored content cannot break out of the `<context_data>` boundary.
 */
export type InstructionContextBlock =
  | { kind: "conversation_summary"; body: string }
  | { kind: "conversation_state"; body: string }
  | { kind: "current_todo_list"; body: string }
  | { kind: "active_plan_artifact"; documentId: string; revisionId: string; body: string }
  | { kind: "activated_skill"; name: string; body: string };

/** Non-tool-derived inputs to the instruction assembler, gathered per run. */
export interface InstructionInput {
  mode: AgentMode;
  botProfile?: BotProfileSnapshot | null;
  memories: MemoryDatum[];
  documents: ReferencedDocument[];
  extraContext: InstructionContextBlock[];
  now?: Date;
}

/** A skill advertised to the model in `<available_skills>`. The renderer owns
 * the markup; a contributor only supplies the structured name/description, so it
 * can never inject raw system instructions through this channel. */
export interface SkillListing {
  name: string;
  description: string;
}

/**
 * The thin router seam. Everything tool / skill / MCP resolution contributes to
 * the instruction layers flows through this typed shape — the assembler never
 * learns the internals of a skill or an MCP server, it only renders their
 * structured contributions into fixed sections. Future skill/MCP assembly plugs
 * in by populating these fields (see `tools/catalog.ts`).
 *
 * `capabilities` is code-generated (plan-mode capability contract), never
 * caller-authored. `skills` is structured data the renderer turns into markup —
 * there is deliberately no free-text instruction channel here.
 */
export interface InstructionContributions {
  capabilities?: string | null;
  skills?: SkillListing[];
}

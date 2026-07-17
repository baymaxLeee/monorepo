import { resolveAgentProfile } from "../profiles/index.js";
import { createToolLoopAgent } from "./tool-loop.js";
import type { ChatAgentInput } from "./types.js";

export async function createAgent(input: ChatAgentInput) {
  const profile = resolveAgentProfile(input.mode);
  switch (profile.runtime) {
    case "tool-loop":
      return createToolLoopAgent(input);
    case "workflow":
    case "harness":
      throw new Error(`agent runtime ${profile.runtime} is not configured`);
  }
}

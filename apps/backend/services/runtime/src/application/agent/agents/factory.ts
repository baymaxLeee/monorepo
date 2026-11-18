import { createToolLoopAgent } from "./tool-loop.js";
import type { ChatAgentInput } from "./types.js";

export async function createAgent(input: ChatAgentInput) {
  return createToolLoopAgent(input);
}

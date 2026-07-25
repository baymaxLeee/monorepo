import { getProvider } from "../../infrastructure/clients/admin.js";
import { generateArkImageUrl } from "../../infrastructure/clients/ark.js";
import type { Character } from "./contracts.js";

export type CharacterRef = {
  id: string;
  name: string;
  appearance: string;
  url: string;
};

export async function generateCharacterSheet(input: {
  orgId: string;
  imageProviderId: string;
  characters: Character[];
  perImageTimeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<CharacterRef[]> {
  const provider = await getProvider(input.imageProviderId, input.orgId);
  const refs: CharacterRef[] = [];
  for (const character of input.characters) {
    if (input.abortSignal?.aborted) {
      throw input.abortSignal.reason;
    }
    try {
      const url = await generateArkImageUrl({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        prompt: [
          "Character reference sheet, single subject, clean neutral background, waist-up, front-facing, even lighting, neutral expression.",
          character.appearance,
        ].join(" "),
        extraBody: provider.extraBody,
        signal: input.abortSignal
          ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(input.perImageTimeoutMs)])
          : AbortSignal.timeout(input.perImageTimeoutMs),
      });
      refs.push({ id: character.id, name: character.name, appearance: character.appearance, url });
    } catch (error) {
      if (input.abortSignal?.aborted) {
        throw error;
      }
      console.warn("[executor] character sheet image failed, degrading that character to text-only", {
        character: character.name,
        error: String(error).slice(0, 200),
      });
    }
  }
  return refs;
}

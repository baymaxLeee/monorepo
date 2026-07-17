import { generateText } from "ai";

import { getDocumentSource } from "../../infrastructure/clients/knowledge.js";
import { buildVideoTextModel, type Character } from "./script.js";
import { MAX_MAIN_CHARACTERS } from "./limits.js";

const VISION_MAX_DIM = 1024;

export type UserCharacterRef = {
  name: string;
  documentId?: string;
  appearance?: string;
};

export async function describeCharacterAppearances(input: {
  orgId: string;
  userId: string;
  textProviderId: string;
  existingCharacters: Character[];
  characters: UserCharacterRef[];
  abortSignal: AbortSignal;
}): Promise<Character[]> {
  const { model } = await buildVideoTextModel(input.textProviderId, input.orgId);
  const existingByName = new Map(input.existingCharacters.map((character) => [character.name, character]));
  const merged: Character[] = [...input.existingCharacters];

  for (const [index, character] of input.characters.entries()) {
    const existing = existingByName.get(character.name);
    let appearance =
      character.appearance?.trim()
      ?? existing?.appearance?.trim()
      ?? "";

    if (character.documentId) {
      try {
        const source = await getDocumentSource(input.userId, character.documentId, {
          maxDim: VISION_MAX_DIM,
        });
        if (!source.mimeType.startsWith("image/")) {
          throw new Error("reference document is not an image");
        }
        const result = await generateText({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [
                    `Describe ${character.name}'s visible appearance in concise tokens for video generation`,
                    "(hair, face, wardrobe, body, distinctive features).",
                    "Output ONLY the description, no preamble.",
                  ].join(" "),
                },
                {
                  type: "file",
                  data: source.bytes,
                  mediaType: source.mimeType,
                },
              ],
            },
          ],
          maxOutputTokens: 200,
          abortSignal: input.abortSignal,
        });
        const visionAppearance = result.text.trim().slice(0, 160);
        if (visionAppearance) appearance = visionAppearance;
      } catch (error) {
        if (input.abortSignal.aborted) throw error;
        console.warn("[executor] character vision describe failed, using text appearance", {
          character: character.name,
          error: String(error).slice(0, 200),
        });
      }
    }

    const resolvedAppearance = (appearance || existing?.appearance || "").slice(0, 160);
    const entry: Character = {
      id: existing?.id ?? `character-${index + 1}`,
      name: character.name.trim().slice(0, 40),
      appearance: resolvedAppearance || existing?.appearance?.slice(0, 160) || character.name.trim().slice(0, 40),
    };

    const existingIndex = merged.findIndex((candidate) => candidate.name === character.name);
    if (existingIndex >= 0) merged[existingIndex] = entry;
    else merged.push(entry);
  }

  return merged.slice(0, MAX_MAIN_CHARACTERS);
}

import { createHash } from "node:crypto";
import type { ShotSpec } from "../../domain/video-production/contracts.js";
import type { ArkImageRef } from "../../infrastructure/clients/ark.js";

export const SEEDANCE_PROMPT_COMPILER_VERSION = "1";

export interface CompiledSeedanceRequest {
  prompt: string;
  images: ArkImageRef[];
  requestSha256: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function compileSeedancePrompt(shot: ShotSpec): CompiledSeedanceRequest {
  const imageReferences = shot.references.filter(
    (reference) => reference.mediaType === "image" && reference.url,
  );
  const images = imageReferences.map((reference) => ({
    url: reference.url!,
    role: "reference_image" as const,
  }));
  const referenceDirections = shot.references
    .map((reference, index) => `${reference.mediaType} reference ${index + 1}: ${reference.purpose}`)
    .join("; ");
  const prompt = [
    `Narrative beat: ${shot.narrativeBeat}`,
    `Subject anchors: ${shot.subjectAnchors.join("; ") || "preserve the established subjects"}`,
    `Action: ${shot.action}`,
    `Camera: ${shot.camera.shotSize}; ${shot.camera.movement}${shot.camera.focus ? `; focus ${shot.camera.focus}` : ""}`,
    `Environment: ${shot.environment}`,
    `Lighting and palette: ${shot.lightingPalette}`,
    shot.audioDirection ? `Audio: ${shot.audioDirection}` : "",
    referenceDirections ? `References: ${referenceDirections}` : "",
    `Continuity: ${shot.continuityContract.join("; ") || "preserve established continuity"}`,
    `Acceptance: ${shot.acceptanceCriteria.join("; ")}`,
    "Render one continuous single-take action. The action must progress without looping or replaying the same beat.",
  ].filter(Boolean).join("\n");
  return {
    prompt,
    images,
    requestSha256: sha256Json({ compilerVersion: SEEDANCE_PROMPT_COMPILER_VERSION, shot, prompt, images }),
  };
}

import { z } from "zod";

const providerSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    model: z.string().min(1),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    extraBody: z.record(z.string(), z.unknown()),
    contextWindow: z.number().int().nonnegative(),
    maxOutputTokens: z.number().int().nonnegative(),
    pricing: z
      .object({
        currency: z.string().min(1),
        unit: z.enum(["generated_item", "generated_second"]),
        unitPriceMicros: z.number().int().nonnegative(),
      })
      .nullable(),
  })
  .strict();

export const mediaProviderCapabilitySchema = providerSnapshotSchema
  .extend({
    providerKind: z.enum(["image", "video"]),
    isDefault: z.boolean(),
  })
  .strict();

export const mediaCapabilitiesSchema = z
  .object({
    providers: z.array(mediaProviderCapabilitySchema).max(32),
  })
  .strict();

export type MediaProviderCapability = z.infer<typeof mediaProviderCapabilitySchema>;
export type MediaCapabilities = z.infer<typeof mediaCapabilitiesSchema>;

import { z } from "zod";

export const productionArtifactTypeSchema = z.enum([
  "creative_brief",
  "script",
  "shot_plan",
  "asset_manifest",
  "render_report",
  "qa_report",
]);
export type ProductionArtifactType = z.infer<typeof productionArtifactTypeSchema>;

export const referenceAssetSchema = z.object({
  id: z.string().min(1).max(80),
  mediaType: z.enum(["image", "video", "audio"]),
  purpose: z.string().min(1).max(120),
  documentId: z.string().max(32).optional(),
  url: z.string().url().optional(),
  licenseStatus: z.enum(["verified", "user_attested", "missing"]),
  consentStatus: z.enum(["not_applicable", "verified", "user_attested", "missing"]),
});
export type ReferenceAsset = z.infer<typeof referenceAssetSchema>;

export const shotSpecSchema = z.object({
  id: z.string().min(1).max(80),
  order: z.number().int().nonnegative(),
  seconds: z.number().int().min(4).max(15),
  narrativeBeat: z.string().min(1).max(500),
  subjectAnchors: z.array(z.string().min(1).max(500)).max(12),
  action: z.string().min(1).max(1_000),
  camera: z.object({
    shotSize: z.string().min(1).max(80),
    movement: z.string().min(1).max(160),
    focus: z.string().max(160).optional(),
  }),
  environment: z.string().min(1).max(500),
  lightingPalette: z.string().min(1).max(300),
  audioDirection: z.string().max(500),
  references: z.array(referenceAssetSchema).max(15),
  continuityContract: z.array(z.string().min(1).max(300)).max(20),
  acceptanceCriteria: z.array(z.string().min(1).max(1_200)).min(1).max(20),
});
export type ShotSpec = z.infer<typeof shotSpecSchema>;

export const shotPlanSchema = z.object({
  version: z.number().int().positive(),
  shots: z.array(shotSpecSchema).min(1).max(12),
});
export type ShotPlan = z.infer<typeof shotPlanSchema>;

export const videoTakeSchema = z.object({
  id: z.string().min(1).max(80),
  shotId: z.string().min(1).max(80),
  number: z.number().int().positive(),
  status: z.enum(["generating", "succeeded", "failed"]),
  providerTaskId: z.string().max(200).optional(),
  stagedMediaId: z.string().max(32).optional(),
  seed: z.number().int(),
  error: z.string().max(500).optional(),
});
export type VideoTake = z.infer<typeof videoTakeSchema>;

export const shotTakeReviewSchema = z.object({
  shotId: z.string().min(1).max(80),
  selectedTakeId: z.string().min(1).max(80).nullable(),
  takes: z.array(videoTakeSchema).min(1),
});
export type ShotTakeReview = z.infer<typeof shotTakeReviewSchema>;

export const productionStageSchema = z.enum([
  "intake",
  "planning",
  "awaiting_storyboard_approval",
  "generating",
  "shot_review",
  "assembling",
  "final_qa",
  "awaiting_publish_approval",
  "publishing",
  "completed",
  "failed",
  "cancelled",
]);
export type ProductionStage = z.infer<typeof productionStageSchema>;

export const productionStatusSchema = z.enum([
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);
export type ProductionStatus = z.infer<typeof productionStatusSchema>;

export interface ProductionArtifactProvenance {
  providerId?: string;
  model?: string;
  compilerVersion?: string;
  sourceDocumentIds: string[];
  actorId?: string;
  createdAt: string;
}

export interface ProductionCostProjection {
  currency: string | null;
  unitPriceMicros: number | null;
  estimatedMicros: number | null;
  budgetLimitMicros: number | null;
  reservedMicros: number;
  reconciledMicros: number;
  releasedMicros: number;
}

export interface VideoProductionProjection {
  id: string;
  taskId: string;
  orgId: string;
  userId: string;
  conversationId: string | null;
  title: string;
  status: ProductionStatus;
  stage: ProductionStage;
  version: number;
  awaitingAction: "storyboard_approval" | "shot_review" | "publish_approval" | null;
  shotPlan: ShotPlan | null;
  shotReviews: ShotTakeReview[];
  cost: ProductionCostProjection;
  stagedMediaId: string | null;
  documentId: string | null;
  qaReport: {
    deterministic: { passed: boolean; checks: Array<{ name: string; passed: boolean; detail: string }> };
    semantic: { status: "passed" | "human_review_required" | "waived"; actorId?: string; reason?: string };
  } | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CostEntryPayload {
  shotId?: string;
  takeId?: string;
  providerTaskId?: string;
  basis?: "requested_seconds" | "provider_reported";
}

export const productionDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve_storyboard"),
    actionId: z.string().min(1).max(80),
    expectedVersion: z.number().int().positive(),
    actorId: z.string().min(1).max(32),
    budgetLimitMicros: z.number().int().nonnegative(),
    currency: z.string().length(3).transform((value) => value.toUpperCase()),
  }),
  z.object({
    action: z.literal("reject_storyboard"),
    actionId: z.string().min(1).max(80),
    expectedVersion: z.number().int().positive(),
    actorId: z.string().min(1).max(32),
    reason: z.string().min(1).max(1000),
  }),
  z.object({
    action: z.literal("revise_storyboard"),
    actionId: z.string().min(1).max(80),
    expectedVersion: z.number().int().positive(),
    actorId: z.string().min(1).max(32),
    shotPlan: shotPlanSchema,
  }),
  z.object({
    action: z.literal("approve_publish"),
    actionId: z.string().min(1).max(80),
    expectedVersion: z.number().int().positive(),
    actorId: z.string().min(1).max(32),
    waiverReason: z.string().min(1).max(1000).optional(),
  }),
  z.object({
    action: z.literal("request_take"),
    actionId: z.string().min(1).max(80),
    expectedVersion: z.number().int().positive(),
    actorId: z.string().min(1).max(32),
    shotId: z.string().min(1).max(80),
  }),
  z.object({
    action: z.literal("approve_takes"),
    actionId: z.string().min(1).max(80),
    expectedVersion: z.number().int().positive(),
    actorId: z.string().min(1).max(32),
    selections: z.array(z.object({
      shotId: z.string().min(1).max(80),
      takeId: z.string().min(1).max(80),
    })).min(1).max(12),
  }),
  z.object({
    action: z.literal("reject_publish"),
    actionId: z.string().min(1).max(80),
    expectedVersion: z.number().int().positive(),
    actorId: z.string().min(1).max(32),
    reason: z.string().min(1).max(1000),
  }),
]);
export type ProductionDecision = z.infer<typeof productionDecisionSchema>;

export const storyboardHookPayloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    actionId: z.string().min(1).max(80),
    actorId: z.string(),
    shotPlanVersion: z.number().int().positive(),
    budgetLimitMicros: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }),
  z.object({
    action: z.literal("revise"),
    actionId: z.string().min(1).max(80),
    actorId: z.string(),
    shotPlan: shotPlanSchema,
  }),
  z.object({
    action: z.literal("reject"),
    actionId: z.string().min(1).max(80),
    actorId: z.string(),
    reason: z.string().min(1),
  }),
]);
export type StoryboardHookPayload = z.infer<typeof storyboardHookPayloadSchema>;

export const shotReviewHookPayloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request_take"),
    actionId: z.string().min(1).max(80),
    actorId: z.string(),
    shotId: z.string(),
  }),
  z.object({
    action: z.literal("approve_takes"),
    actionId: z.string().min(1).max(80),
    actorId: z.string(),
    selections: z.array(z.object({ shotId: z.string(), takeId: z.string() })),
  }),
]);
export type ShotReviewHookPayload = z.infer<typeof shotReviewHookPayloadSchema>;

export const publishHookPayloadSchema = z.discriminatedUnion("approved", [
  z.object({
    approved: z.literal(true),
    actionId: z.string().min(1).max(80),
    actorId: z.string(),
    waiverReason: z.string().optional(),
  }),
  z.object({
    approved: z.literal(false),
    actionId: z.string().min(1).max(80),
    actorId: z.string(),
    reason: z.string().min(1),
  }),
]);
export type PublishHookPayload = z.infer<typeof publishHookPayloadSchema>;

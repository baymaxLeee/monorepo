import { randomBytes } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import {
  shotPlanSchema,
  type ProductionArtifactType,
  type ShotTakeReview,
  type ShotPlan,
  type VideoProductionProjection,
} from "../../domain/video-production/contracts.js";
import { getDb } from "../../infrastructure/persistence/index.js";
import {
  tasks,
  videoProductionArtifacts,
  videoProductionEvents,
  videoProductions,
} from "../../infrastructure/persistence/schema.js";
import { ConflictError, NotFoundError } from "../errors.js";
import type { Script } from "../video/contracts.js";
import { SEEDANCE_PROMPT_COMPILER_VERSION, sha256Json } from "./compiler.js";

function newId(): string {
  return randomBytes(16).toString("hex");
}

export async function nextSequence(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  productionId: string,
): Promise<number> {
  const [latest] = await tx
    .select({ sequence: videoProductionEvents.sequence })
    .from(videoProductionEvents)
    .where(eq(videoProductionEvents.productionId, productionId))
    .orderBy(desc(videoProductionEvents.sequence))
    .limit(1);
  return (latest?.sequence ?? 0) + 1;
}

async function addArtifact(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  input: {
    productionId: string;
    artifactType: ProductionArtifactType;
    payload: unknown;
    providerId?: string;
    sourceDocumentIds?: string[];
  },
): Promise<void> {
  await tx.insert(videoProductionArtifacts).values({
    id: newId(),
    productionId: input.productionId,
    artifactType: input.artifactType,
    version: 1,
    inputSha256: sha256Json(input.payload),
    payload: input.payload,
    provenance: {
      providerId: input.providerId,
      compilerVersion: SEEDANCE_PROMPT_COMPILER_VERSION,
      sourceDocumentIds: input.sourceDocumentIds ?? [],
      createdAt: new Date().toISOString(),
    },
    createdAt: new Date(),
  });
}

export async function initializeVideoProduction(input: {
  workflowRunId: string;
  orgId: string;
  userId: string;
  conversationId?: string;
  title: string;
  creativeBrief: string;
  script: Script;
  shotPlan: ShotPlan;
  sourceCharacterRefs?: Array<{ name: string; documentId?: string }>;
}): Promise<VideoProductionProjection> {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.workflowRunId, input.workflowRunId));
  if (!task) {
    throw new NotFoundError(`task for workflow ${input.workflowRunId} not found`);
  }
  const [existing] = await db
    .select({ projection: videoProductions.projection })
    .from(videoProductions)
    .where(eq(videoProductions.taskId, task.id));
  if (existing) {
    return existing.projection;
  }

  const shotPlan = shotPlanSchema.parse(input.shotPlan);
  const now = new Date();
  const projection: VideoProductionProjection = {
    id: task.id,
    taskId: task.id,
    orgId: input.orgId,
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    title: input.title,
    status: "running",
    stage: "planning",
    version: 1,
    awaitingAction: null,
    shotPlan,
    shotReviews: [],
    cost: {
      currency: null,
      unitPriceMicros: null,
      estimatedMicros: null,
      budgetLimitMicros: null,
      reservedMicros: 0,
      reconciledMicros: 0,
      releasedMicros: 0,
    },
    stagedMediaId: null,
    documentId: null,
    qaReport: null,
    error: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.transaction(async (tx) => {
    await tx.insert(videoProductions).values({
      id: task.id,
      taskId: task.id,
      orgId: input.orgId,
      userId: input.userId,
      conversationId: input.conversationId,
      status: projection.status,
      stage: projection.stage,
      version: projection.version,
      projection,
      createdAt: now,
      updatedAt: now,
    });
    await addArtifact(tx, {
      productionId: task.id,
      artifactType: "creative_brief",
      payload: { creativeBrief: input.creativeBrief, title: input.title },
    });
    await addArtifact(tx, {
      productionId: task.id,
      artifactType: "script",
      payload: input.script,
    });
    await addArtifact(tx, {
      productionId: task.id,
      artifactType: "shot_plan",
      payload: shotPlan,
    });
    await addArtifact(tx, {
      productionId: task.id,
      artifactType: "asset_manifest",
      payload: {
        references: shotPlan.shots.flatMap((shot) => shot.references),
      },
      sourceDocumentIds: (input.sourceCharacterRefs ?? []).flatMap((reference) =>
        reference.documentId ? [reference.documentId] : [],
      ),
    });
    await tx.insert(videoProductionEvents).values({
      productionId: task.id,
      sequence: 1,
      kind: "production_created",
      stage: projection.stage,
      payload: { shotPlanVersion: shotPlan.version },
      createdAt: now,
    });
  });
  return projection;
}

export async function markAwaitingStoryboardApproval(productionId: string): Promise<VideoProductionProjection> {
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      status: "awaiting_approval",
      stage: "awaiting_storyboard_approval",
      awaitingAction: "storyboard_approval",
    }),
    "storyboard_approval_requested",
    {},
  );
}

export async function configureVideoProductionCost(
  productionId: string,
  pricing: { currency: string; unitPriceMicros: number },
): Promise<VideoProductionProjection> {
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      cost: {
        ...projection.cost,
        currency: pricing.currency,
        unitPriceMicros: pricing.unitPriceMicros,
        estimatedMicros: (projection.shotPlan?.shots ?? []).reduce(
          (total, shot) => total + shot.seconds * pricing.unitPriceMicros,
          0,
        ),
      },
    }),
    "cost_estimated",
    {
      currency: pricing.currency,
      unitPriceMicros: pricing.unitPriceMicros,
    },
  );
}

export async function markVideoProductionGenerating(
  productionId: string,
  budget: { budgetLimitMicros: number; currency: string },
): Promise<VideoProductionProjection> {
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      status: "running",
      stage: "generating",
      awaitingAction: null,
      cost: {
        ...projection.cost,
        budgetLimitMicros: budget.budgetLimitMicros,
        currency: budget.currency,
      },
    }),
    "storyboard_approved",
    budget,
  );
}

export async function reviseStoryboard(productionId: string, shotPlan: ShotPlan, actorId: string): Promise<ShotPlan> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(videoProductions).where(eq(videoProductions.id, productionId)).for("update");
    if (!row?.projection.shotPlan) {
      throw new NotFoundError(`video production ${productionId} has no shot plan`);
    }
    if (row.stage !== "awaiting_storyboard_approval") {
      throw new ConflictError("video production is not awaiting storyboard approval");
    }
    const version = row.projection.shotPlan.version + 1;
    const revised = shotPlanSchema.parse({ ...shotPlan, version });
    const shotIds = revised.shots.map((shot) => shot.id);
    if (new Set(shotIds).size !== shotIds.length) {
      throw new ConflictError("shot ids must be unique");
    }
    const unitPriceMicros = row.projection.cost.unitPriceMicros;
    const now = new Date();
    const next: VideoProductionProjection = {
      ...row.projection,
      version: row.version + 1,
      shotPlan: revised,
      cost: {
        ...row.projection.cost,
        estimatedMicros:
          unitPriceMicros == null
            ? null
            : revised.shots.reduce((total, shot) => total + shot.seconds * unitPriceMicros, 0),
      },
      updatedAt: now.toISOString(),
    };
    await tx
      .update(videoProductions)
      .set({
        version: next.version,
        projection: next,
        updatedAt: now,
      })
      .where(eq(videoProductions.id, productionId));
    await tx.insert(videoProductionArtifacts).values({
      id: newId(),
      productionId,
      artifactType: "shot_plan",
      version,
      inputSha256: sha256Json(revised),
      payload: revised,
      provenance: {
        compilerVersion: SEEDANCE_PROMPT_COMPILER_VERSION,
        sourceDocumentIds: revised.shots.flatMap((shot) =>
          shot.references.flatMap((reference) => (reference.documentId ? [reference.documentId] : [])),
        ),
        actorId,
        createdAt: now.toISOString(),
      },
      createdAt: now,
    });
    await tx.insert(videoProductionEvents).values({
      productionId,
      sequence: await nextSequence(tx, productionId),
      kind: "storyboard_revised",
      stage: next.stage,
      actorId,
      payload: { shotPlanVersion: version },
      createdAt: now,
    });
    return revised;
  });
}

export async function markAwaitingShotReview(
  productionId: string,
  shotReviews: ShotTakeReview[],
): Promise<VideoProductionProjection> {
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      status: "awaiting_approval",
      stage: "shot_review",
      awaitingAction: "shot_review",
      shotReviews,
    }),
    "shot_review_requested",
    { shotCount: shotReviews.length },
  );
}

export async function recordVideoTake(
  productionId: string,
  shotId: string,
  take: ShotTakeReview["takes"][number],
): Promise<VideoProductionProjection> {
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      status: "awaiting_approval",
      stage: "shot_review",
      awaitingAction: "shot_review",
      shotReviews: projection.shotReviews.map((review) =>
        review.shotId === shotId ? { ...review, takes: [...review.takes, take] } : review,
      ),
    }),
    "take_created",
    {
      shotId,
      takeId: take.id,
      takeNumber: take.number,
      status: take.status,
    },
  );
}

export async function markVideoTakesSelected(
  productionId: string,
  selections: Array<{ shotId: string; takeId: string }>,
): Promise<VideoProductionProjection> {
  const selected = new Map(selections.map((selection) => [selection.shotId, selection.takeId]));
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      status: "running",
      stage: "assembling",
      awaitingAction: null,
      shotReviews: projection.shotReviews.map((review) => ({
        ...review,
        selectedTakeId: selected.get(review.shotId) ?? review.selectedTakeId,
      })),
    }),
    "takes_approved",
    { selections },
  );
}

export async function completeVideoProduction(
  productionId: string,
  documentId: string,
): Promise<VideoProductionProjection> {
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      status: "completed",
      stage: "completed",
      awaitingAction: null,
      documentId,
    }),
    "production_completed",
    { documentId },
    true,
  );
}

export async function markAwaitingPublishApproval(
  productionId: string,
  stagedMediaId: string,
  qaReport: NonNullable<VideoProductionProjection["qaReport"]>,
): Promise<VideoProductionProjection> {
  const projection = await updateProjection(
    productionId,
    (current) => ({
      ...current,
      status: "awaiting_approval",
      stage: "awaiting_publish_approval",
      awaitingAction: "publish_approval",
      stagedMediaId,
      qaReport,
    }),
    "publish_approval_requested",
    { stagedMediaId, qaReport },
  );
  await getDb()
    .insert(videoProductionArtifacts)
    .values({
      id: newId(),
      productionId,
      artifactType: "qa_report",
      version: 1,
      inputSha256: sha256Json(qaReport),
      payload: qaReport,
      provenance: {
        sourceDocumentIds: [],
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  return projection;
}

export async function recordVideoRenderReport(
  productionId: string,
  report: { shots: Array<Record<string, unknown>> },
): Promise<VideoProductionProjection> {
  const projection = await updateProjection(
    productionId,
    (current) => ({
      ...current,
      stage: "assembling",
    }),
    "render_completed",
    { shotCount: report.shots.length },
  );
  await getDb()
    .insert(videoProductionArtifacts)
    .values({
      id: newId(),
      productionId,
      artifactType: "render_report",
      version: 1,
      inputSha256: sha256Json(report),
      payload: report,
      provenance: {
        sourceDocumentIds: [],
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  return projection;
}

export async function markVideoProductionFinalQa(productionId: string): Promise<VideoProductionProjection> {
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      stage: "final_qa",
    }),
    "final_qa_started",
    {},
  );
}

export async function markVideoProductionPublishing(
  productionId: string,
  actorId: string,
  waiverReason?: string,
): Promise<VideoProductionProjection> {
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      status: "running",
      stage: "publishing",
      awaitingAction: null,
      qaReport:
        projection.qaReport?.semantic.status === "human_review_required"
          ? {
              ...projection.qaReport,
              semantic: { status: "waived", actorId, reason: waiverReason },
            }
          : projection.qaReport,
    }),
    "publish_approved",
    { actorId, waiverReason },
  );
}

export async function failVideoProduction(productionId: string, error: string): Promise<VideoProductionProjection> {
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      status: "failed",
      stage: "failed",
      awaitingAction: null,
      error: error.slice(0, 2000),
    }),
    "production_failed",
    { error: error.slice(0, 500) },
    true,
  );
}

export async function cancelVideoProductionProjection(productionId: string): Promise<VideoProductionProjection | null> {
  const [row] = await getDb()
    .select({ projection: videoProductions.projection })
    .from(videoProductions)
    .where(eq(videoProductions.id, productionId));
  if (!row) {
    return null;
  }
  if (row.projection.status === "completed" || row.projection.status === "cancelled") {
    return row.projection;
  }
  return updateProjection(
    productionId,
    (projection) => ({
      ...projection,
      status: "cancelled",
      stage: "cancelled",
      awaitingAction: null,
    }),
    "production_cancelled",
    {},
    true,
  );
}

async function updateProjection(
  productionId: string,
  update: (projection: VideoProductionProjection) => VideoProductionProjection,
  eventKind: string,
  eventPayload: Record<string, unknown>,
  terminal = false,
): Promise<VideoProductionProjection> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(videoProductions).where(eq(videoProductions.id, productionId)).for("update");
    if (!row) {
      throw new NotFoundError(`video production ${productionId} not found`);
    }
    if (["completed", "failed", "cancelled"].includes(row.projection.status)) {
      return row.projection;
    }
    const now = new Date();
    const next = update(row.projection);
    next.version = row.version + 1;
    next.updatedAt = now.toISOString();
    await tx
      .update(videoProductions)
      .set({
        status: next.status,
        stage: next.stage,
        version: next.version,
        projection: next,
        updatedAt: now,
        finishedAt: terminal ? now : null,
      })
      .where(eq(videoProductions.id, productionId));
    await tx.insert(videoProductionEvents).values({
      productionId,
      sequence: await nextSequence(tx, productionId),
      kind: eventKind,
      stage: next.stage,
      payload: eventPayload,
      createdAt: now,
    });
    return next;
  });
}

export async function getVideoProduction(
  productionId: string,
  ownerService: string,
): Promise<{
  production: VideoProductionProjection;
  events: Array<Record<string, unknown>>;
}> {
  const [row] = await getDb()
    .select({
      projection: videoProductions.projection,
      ownerService: tasks.ownerService,
    })
    .from(videoProductions)
    .innerJoin(tasks, eq(videoProductions.taskId, tasks.id))
    .where(eq(videoProductions.id, productionId));
  if (!row || row.ownerService !== ownerService) {
    throw new NotFoundError(`video production ${productionId} not found`);
  }
  const events = await getDb()
    .select({
      sequence: videoProductionEvents.sequence,
      kind: videoProductionEvents.kind,
      stage: videoProductionEvents.stage,
      actorId: videoProductionEvents.actorId,
      payload: videoProductionEvents.payload,
      createdAt: videoProductionEvents.createdAt,
    })
    .from(videoProductionEvents)
    .where(eq(videoProductionEvents.productionId, productionId))
    .orderBy(videoProductionEvents.sequence);
  return {
    production: row.projection,
    events: events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function getVideoProductionProjection(
  productionId: string,
  ownerService: string,
): Promise<VideoProductionProjection | null> {
  const [row] = await getDb()
    .select({
      projection: videoProductions.projection,
      ownerService: tasks.ownerService,
    })
    .from(videoProductions)
    .innerJoin(tasks, eq(videoProductions.taskId, tasks.id))
    .where(eq(videoProductions.id, productionId));
  if (!row) {
    return null;
  }
  if (row.ownerService !== ownerService) {
    throw new NotFoundError(`video production ${productionId} not found`);
  }
  return row.projection;
}

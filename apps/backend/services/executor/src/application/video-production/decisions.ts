import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";

import { ConflictError, NotFoundError } from "../errors.js";
import {
  productionDecisionSchema,
  type ProductionDecision,
  type VideoProductionProjection,
} from "../../domain/video-production/contracts.js";
import {
  publishApprovalHook,
  publishHookToken,
  shotReviewHook,
  shotReviewHookToken,
  storyboardApprovalHook,
  storyboardHookToken,
} from "./hooks.js";
import { logger } from "../../infrastructure/observability/logger.js";
import { getDb } from "../../infrastructure/persistence/index.js";
import {
  tasks,
  videoProductionDecisions,
  videoProductionEvents,
  videoProductions,
} from "../../infrastructure/persistence/schema.js";
import { sha256Json } from "./compiler.js";
import {
  getVideoProduction,
  nextSequence,
} from "./service.js";

function newId(): string {
  return randomBytes(16).toString("hex");
}

const PENDING_DECISION_LEASE_MS = 60_000;
let decisionRecoveryTimer: ReturnType<typeof setInterval> | undefined;

export async function decideVideoProduction(
  productionId: string,
  ownerService: string,
  rawDecision: unknown,
): Promise<VideoProductionProjection> {
  const decision = productionDecisionSchema.parse(rawDecision);
  const db = getDb();
  const prepared = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        production: videoProductions,
        ownerService: tasks.ownerService,
      })
      .from(videoProductions)
      .innerJoin(tasks, eq(videoProductions.taskId, tasks.id))
      .where(eq(videoProductions.id, productionId))
      .for("update");
    if (!row || row.ownerService !== ownerService) {
      throw new NotFoundError(`video production ${productionId} not found`);
    }
    const [existing] = await tx
      .select()
      .from(videoProductionDecisions)
      .where(
        and(
          eq(videoProductionDecisions.productionId, productionId),
          eq(videoProductionDecisions.actionId, decision.actionId),
        ),
      );
    if (existing) {
      const persisted = productionDecisionSchema.parse(existing.payload);
      if (sha256Json(persisted) !== sha256Json(decision)) {
        throw new ConflictError(
          "video production action id was already used for another decision",
        );
      }
      if (existing.status === "delivered") {
        return {
          duplicate: true as const,
          projection: row.production.projection,
        };
      }
      if (
        row.production.version !== decision.expectedVersion ||
        !isAwaitingDecision(row.production.projection, decision)
      ) {
        await tx
          .update(videoProductionDecisions)
          .set({
            status: "delivered",
            deliveredAt: new Date(),
          })
          .where(eq(videoProductionDecisions.id, existing.id));
        return {
          duplicate: true as const,
          projection: row.production.projection,
        };
      }
      if (
        existing.createdAt.getTime() >
        Date.now() - PENDING_DECISION_LEASE_MS
      ) {
        return {
          duplicate: true as const,
          projection: row.production.projection,
        };
      }
      await tx
        .update(videoProductionDecisions)
        .set({ createdAt: new Date() })
        .where(eq(videoProductionDecisions.id, existing.id));
      return {
        duplicate: false as const,
        decision: persisted,
        projection: row.production.projection,
      };
    }
    if (row.production.version !== decision.expectedVersion) {
      throw new ConflictError(
        "video production version changed",
        "version_conflict",
        {
          expected: decision.expectedVersion,
          actual: row.production.version,
        },
      );
    }
    validateDecision(row.production.projection, decision);
    const [pending] = await tx
      .select()
      .from(videoProductionDecisions)
      .where(
        and(
          eq(videoProductionDecisions.productionId, productionId),
          eq(videoProductionDecisions.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) {
      if (
        pending.createdAt.getTime() >
        Date.now() - PENDING_DECISION_LEASE_MS
      ) {
        throw new ConflictError(
          "another video production decision is being delivered",
        );
      }
      const persisted = productionDecisionSchema.parse(pending.payload);
      if (
        row.production.version === persisted.expectedVersion &&
        isAwaitingDecision(row.production.projection, persisted)
      ) {
        await tx
          .update(videoProductionDecisions)
          .set({ createdAt: new Date() })
          .where(eq(videoProductionDecisions.id, pending.id));
        return {
          duplicate: false as const,
          decision: persisted,
          projection: row.production.projection,
        };
      }
      await tx
        .update(videoProductionDecisions)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(eq(videoProductionDecisions.id, pending.id));
    }
    const now = new Date();
    await tx.insert(videoProductionDecisions).values({
      id: newId(),
      productionId,
      actionId: decision.actionId,
      action: decision.action,
      expectedVersion: decision.expectedVersion,
      actorId: decision.actorId,
      reason: "reason" in decision ? decision.reason : undefined,
      status: "pending",
      payload: decision as unknown as Record<string, unknown>,
      createdAt: now,
    });
    await tx.insert(videoProductionEvents).values({
      productionId,
      sequence: await nextSequence(tx, productionId),
      kind: `${decision.action}_submitted`,
      stage: row.production.stage,
      actorId: decision.actorId,
      payload: {
        ...("reason" in decision ? { reason: decision.reason } : {}),
        ...("shotId" in decision ? { shotId: decision.shotId } : {}),
        ...(decision.action === "revise_storyboard"
          ? { requestedShotPlanVersion: decision.shotPlan.version }
          : {}),
        ...(decision.action === "approve_publish" && decision.waiverReason
          ? { waiverReason: decision.waiverReason }
          : {}),
      },
      createdAt: now,
    });
    return {
      duplicate: false as const,
      decision,
      projection: row.production.projection,
    };
  });
  if (prepared.duplicate) return prepared.projection;
  await deliverDecision(productionId, prepared.decision, prepared.projection);
  return (await getVideoProduction(productionId, ownerService)).production;
}

export async function recoverStaleVideoProductionDecisions(): Promise<void> {
  const cutoff = new Date(Date.now() - PENDING_DECISION_LEASE_MS);
  const stale = await getDb()
    .select({ productionId: videoProductionDecisions.productionId })
    .from(videoProductionDecisions)
    .where(
      and(
        eq(videoProductionDecisions.status, "pending"),
        lt(videoProductionDecisions.createdAt, cutoff),
      ),
    )
    .limit(100);

  for (const row of stale) {
    try {
      const claimed = await claimStalePendingDecision(row.productionId);
      if (!claimed) continue;
      await deliverDecision(
        row.productionId,
        claimed.decision,
        claimed.projection,
      );
      logger.info(
        { productionId: row.productionId, actionId: claimed.decision.actionId },
        "recovered stale video production decision",
      );
    } catch (error) {
      logger.error(
        { err: error, productionId: row.productionId },
        "failed to recover stale video production decision",
      );
    }
  }
}

export function startStaleVideoProductionDecisionRecovery(): void {
  if (decisionRecoveryTimer) return;
  decisionRecoveryTimer = setInterval(
    () => void recoverStaleVideoProductionDecisions(),
    PENDING_DECISION_LEASE_MS,
  );
  decisionRecoveryTimer.unref();
}

async function claimStalePendingDecision(productionId: string): Promise<{
  decision: ProductionDecision;
  projection: VideoProductionProjection;
} | null> {
  return getDb().transaction(async (tx) => {
    const [production] = await tx
      .select()
      .from(videoProductions)
      .where(eq(videoProductions.id, productionId))
      .for("update");
    if (!production) return null;
    const [pending] = await tx
      .select()
      .from(videoProductionDecisions)
      .where(
        and(
          eq(videoProductionDecisions.productionId, productionId),
          eq(videoProductionDecisions.status, "pending"),
        ),
      )
      .limit(1);
    if (
      !pending ||
      pending.createdAt.getTime() > Date.now() - PENDING_DECISION_LEASE_MS
    ) {
      return null;
    }
    const decision = productionDecisionSchema.parse(pending.payload);
    if (
      production.version !== decision.expectedVersion ||
      !isAwaitingDecision(production.projection, decision)
    ) {
      await tx
        .update(videoProductionDecisions)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(eq(videoProductionDecisions.id, pending.id));
      return null;
    }
    await tx
      .update(videoProductionDecisions)
      .set({ createdAt: new Date() })
      .where(eq(videoProductionDecisions.id, pending.id));
    return { decision, projection: production.projection };
  });
}

function isAwaitingDecision(
  projection: VideoProductionProjection,
  decision: ProductionDecision,
): boolean {
  if (
    decision.action === "approve_publish" ||
    decision.action === "reject_publish"
  ) {
    return projection.stage === "awaiting_publish_approval";
  }
  if (
    decision.action === "request_take" ||
    decision.action === "approve_takes"
  ) {
    return projection.stage === "shot_review";
  }
  return projection.stage === "awaiting_storyboard_approval";
}

async function deliverDecision(
  productionId: string,
  decision: ProductionDecision,
  projection: VideoProductionProjection,
): Promise<void> {
  validateDecision(projection, decision);
  if (
    decision.action === "approve_publish" ||
    decision.action === "reject_publish"
  ) {
    await publishApprovalHook.resume(
      publishHookToken(productionId),
      decision.action === "approve_publish"
        ? {
            approved: true,
            actionId: decision.actionId,
            actorId: decision.actorId,
            waiverReason: decision.waiverReason,
          }
        : {
            approved: false,
            actionId: decision.actionId,
            actorId: decision.actorId,
            reason: decision.reason,
          },
    );
    await recordDeliveredDecision(productionId, decision);
    return;
  }
  if (
    decision.action === "request_take" ||
    decision.action === "approve_takes"
  ) {
    await shotReviewHook.resume(
      shotReviewHookToken(productionId),
      decision.action === "request_take"
        ? {
            action: "request_take",
            actionId: decision.actionId,
            actorId: decision.actorId,
            shotId: decision.shotId,
          }
        : {
            action: "approve_takes",
            actionId: decision.actionId,
            actorId: decision.actorId,
            selections: decision.selections,
          },
    );
    await recordDeliveredDecision(productionId, decision);
    return;
  }
  const shotPlan = projection.shotPlan;
  if (!shotPlan)
    throw new ConflictError("video production has no approved shot plan");
  const token = storyboardHookToken(productionId);
  if (decision.action === "revise_storyboard") {
    await storyboardApprovalHook.resume(token, {
      action: "revise",
      actionId: decision.actionId,
      actorId: decision.actorId,
      shotPlan: decision.shotPlan,
    });
  } else {
    await storyboardApprovalHook.resume(
      token,
      decision.action === "approve_storyboard"
        ? {
            action: "approve",
            actionId: decision.actionId,
            actorId: decision.actorId,
            shotPlanVersion: shotPlan.version,
            budgetLimitMicros: decision.budgetLimitMicros,
            currency: decision.currency,
          }
        : {
            action: "reject",
            actionId: decision.actionId,
            actorId: decision.actorId,
            reason: decision.reason,
          },
    );
  }
  await recordDeliveredDecision(productionId, decision);
}

function validateDecision(
  projection: VideoProductionProjection,
  decision: ProductionDecision,
): void {
  if (
    decision.action === "approve_publish" ||
    decision.action === "reject_publish"
  ) {
    if (projection.stage !== "awaiting_publish_approval") {
      throw new ConflictError(
        "video production is not awaiting publish approval",
      );
    }
    if (
      decision.action === "approve_publish" &&
      projection.qaReport?.semantic.status === "human_review_required" &&
      !decision.waiverReason
    ) {
      throw new ConflictError("semantic QA waiver requires a reason");
    }
    return;
  }
  if (
    decision.action === "request_take" ||
    decision.action === "approve_takes"
  ) {
    if (
      projection.stage !== "shot_review" ||
      projection.shotReviews.length === 0
    ) {
      throw new ConflictError("video production is not awaiting shot review");
    }
    if (decision.action === "request_take") {
      if (
        !projection.shotReviews.some(
          (review) => review.shotId === decision.shotId,
        )
      ) {
        throw new ConflictError(
          `shot ${decision.shotId} is not part of this production`,
        );
      }
      return;
    }
    if (decision.selections.length !== projection.shotReviews.length) {
      throw new ConflictError(
        "one successful take must be selected for every shot",
      );
    }
    const selections = new Map(
      decision.selections.map((selection) => [
        selection.shotId,
        selection.takeId,
      ]),
    );
    if (selections.size !== projection.shotReviews.length) {
      throw new ConflictError(
        "take selections contain duplicate or missing shots",
      );
    }
    for (const review of projection.shotReviews) {
      const takeId = selections.get(review.shotId);
      const take = review.takes.find((candidate) => candidate.id === takeId);
      if (!take || take.status !== "succeeded") {
        throw new ConflictError(
          `shot ${review.shotId} requires a successful take`,
        );
      }
    }
    return;
  }
  if (
    projection.stage !== "awaiting_storyboard_approval" ||
    !projection.shotPlan
  ) {
    throw new ConflictError(
      "video production is not awaiting storyboard approval",
    );
  }
  if (decision.action !== "approve_storyboard") return;
  if (projection.cost.currency !== decision.currency) {
    throw new ConflictError(
      "approved currency does not match the production estimate",
    );
  }
  if (
    projection.cost.estimatedMicros == null ||
    decision.budgetLimitMicros < projection.cost.estimatedMicros
  ) {
    throw new ConflictError(
      "approved budget is below the storyboard estimate",
      "budget_too_low",
      {
        estimatedMicros: projection.cost.estimatedMicros,
        budgetLimitMicros: decision.budgetLimitMicros,
      },
    );
  }
}

async function recordDeliveredDecision(
  productionId: string,
  decision: ProductionDecision,
): Promise<void> {
  await getDb()
    .update(videoProductionDecisions)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
    })
    .where(
      and(
        eq(videoProductionDecisions.productionId, productionId),
        eq(videoProductionDecisions.actionId, decision.actionId),
      ),
    );
}

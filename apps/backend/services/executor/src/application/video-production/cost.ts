import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { CostEntryPayload, VideoProductionProjection } from "../../domain/video-production/contracts.js";
import { getDb } from "../../infrastructure/persistence/index.js";
import { videoCostEntries, videoProductions } from "../../infrastructure/persistence/schema.js";
import { ConflictError, NotFoundError } from "../errors.js";

function newId(): string {
  return randomBytes(16).toString("hex");
}

async function applyCostEntry(input: {
  productionId: string;
  idempotencyKey: string;
  kind: "reserve" | "reconcile" | "release";
  amountMicros: number;
  currency: string;
  payload: CostEntryPayload;
}): Promise<VideoProductionProjection> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(videoCostEntries)
      .where(
        and(
          eq(videoCostEntries.productionId, input.productionId),
          eq(videoCostEntries.idempotencyKey, input.idempotencyKey),
        ),
      );
    const [row] = await tx
      .select()
      .from(videoProductions)
      .where(eq(videoProductions.id, input.productionId))
      .for("update");
    if (!row) {
      throw new NotFoundError(`video production ${input.productionId} not found`);
    }
    if (existing) {
      return row.projection;
    }
    const current = row.projection.cost;
    if (!current.currency || current.currency !== input.currency) {
      throw new ConflictError("video production currency does not match provider pricing");
    }
    if (input.kind === "reserve") {
      const committed = current.reservedMicros + current.reconciledMicros + input.amountMicros;
      if (current.budgetLimitMicros == null || committed > current.budgetLimitMicros) {
        throw new ConflictError("video production budget exceeded", "budget_exceeded", {
          committed,
          budgetLimitMicros: current.budgetLimitMicros,
        });
      }
    } else if (input.amountMicros > current.reservedMicros) {
      throw new ConflictError("cost settlement exceeds outstanding reservation");
    }
    const nextCost = {
      ...current,
      reservedMicros:
        input.kind === "reserve"
          ? current.reservedMicros + input.amountMicros
          : current.reservedMicros - input.amountMicros,
      reconciledMicros:
        input.kind === "reconcile" ? current.reconciledMicros + input.amountMicros : current.reconciledMicros,
      releasedMicros: input.kind === "release" ? current.releasedMicros + input.amountMicros : current.releasedMicros,
    };
    const projection = {
      ...row.projection,
      version: row.version + 1,
      cost: nextCost,
      updatedAt: new Date().toISOString(),
    };
    await tx.insert(videoCostEntries).values({
      id: newId(),
      productionId: input.productionId,
      idempotencyKey: input.idempotencyKey,
      kind: input.kind,
      amountMicros: input.amountMicros,
      currency: input.currency,
      payload: input.payload,
      createdAt: new Date(),
    });
    await tx
      .update(videoProductions)
      .set({
        version: projection.version,
        projection,
        updatedAt: new Date(),
      })
      .where(eq(videoProductions.id, input.productionId));
    return projection;
  });
}

export function reserveVideoCost(input: Omit<Parameters<typeof applyCostEntry>[0], "kind">) {
  return applyCostEntry({ ...input, kind: "reserve" });
}

export function reconcileVideoCost(input: Omit<Parameters<typeof applyCostEntry>[0], "kind">) {
  return applyCostEntry({ ...input, kind: "reconcile" });
}

export function releaseVideoCost(input: Omit<Parameters<typeof applyCostEntry>[0], "kind">) {
  return applyCostEntry({ ...input, kind: "release" });
}

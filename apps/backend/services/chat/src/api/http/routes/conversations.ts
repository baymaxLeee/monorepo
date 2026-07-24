import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { getAuth } from "../middleware/auth.js";
import {
  decideVideoProduction,
  getVideoProduction,
  type ProductionDecision,
} from "../../../infrastructure/clients/executor.js";
import { ForbiddenError, NotFoundError } from "../../../application/errors.js";
import { getStagedMediaSource } from "../../../infrastructure/clients/knowledge.js";
import { activeAgentStreamRunId } from "../../../application/agent/streams/service.js";
import { getConversationContext } from "../../../application/agent/index.js";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getConversationDocument,
  getConversationDocumentSource,
  getConversationFile,
  listConversations,
  updateConversation,
  updateConversationDocument,
} from "../../../application/conversations.js";

export const conversationsRoutes = new Hono();

const createSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  provider_id: z.string().max(32).optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content_md: z.string().optional(),
});

const shotPlanInputSchema = z.object({
  version: z.number().int().positive(),
  shots: z.array(z.object({
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
    references: z.array(z.object({
      id: z.string().min(1).max(80),
      mediaType: z.enum(["image", "video", "audio"]),
      purpose: z.string().min(1).max(120),
      documentId: z.string().max(32).optional(),
      url: z.string().url().optional(),
      licenseStatus: z.enum(["verified", "user_attested", "missing"]),
      consentStatus: z.enum(["not_applicable", "verified", "user_attested", "missing"]),
    })).max(15),
    continuityContract: z.array(z.string().min(1).max(300)).max(20),
    acceptanceCriteria: z.array(z.string().min(1).max(1_200)).min(1).max(20),
  })).min(1).max(12),
});

const productionDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve_storyboard"),
    action_id: z.string().min(1).max(80),
    expected_version: z.number().int().positive(),
    budget_limit_micros: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }),
  z.object({
    action: z.literal("reject_storyboard"),
    action_id: z.string().min(1).max(80),
    expected_version: z.number().int().positive(),
    reason: z.string().min(1).max(1000),
  }),
  z.object({
    action: z.literal("revise_storyboard"),
    action_id: z.string().min(1).max(80),
    expected_version: z.number().int().positive(),
    shot_plan: shotPlanInputSchema,
  }),
  z.object({
    action: z.literal("approve_publish"),
    action_id: z.string().min(1).max(80),
    expected_version: z.number().int().positive(),
    waiver_reason: z.string().min(1).max(1000).optional(),
  }),
  z.object({
    action: z.literal("request_take"),
    action_id: z.string().min(1).max(80),
    expected_version: z.number().int().positive(),
    shot_id: z.string().min(1).max(80),
  }),
  z.object({
    action: z.literal("approve_takes"),
    action_id: z.string().min(1).max(80),
    expected_version: z.number().int().positive(),
    selections: z.array(z.object({
      shot_id: z.string().min(1).max(80),
      take_id: z.string().min(1).max(80),
    })).min(1).max(12),
  }),
  z.object({
    action: z.literal("reject_publish"),
    action_id: z.string().min(1).max(80),
    expected_version: z.number().int().positive(),
    reason: z.string().min(1).max(1000),
  }),
]);

function canApproveProduction(
  auth: ReturnType<typeof getAuth>,
  production: { userId?: string; orgId?: string },
): boolean {
  if (production.userId === auth.userId) return true;
  if (production.orgId !== auth.orgId) return false;
  return auth.orgRole === "owner" || auth.orgRole === "admin" || auth.roles.includes("video_production.approve");
}

async function authorizedProduction(
  auth: ReturnType<typeof getAuth>,
  conversationId: string,
  productionId: string,
) {
  const detail = await getVideoProduction(productionId);
  const production = detail.production;
  if (production.conversationId !== conversationId || production.orgId !== auth.orgId) {
    throw new NotFoundError(`video production ${productionId} not found in conversation ${conversationId}`);
  }
  if (!canApproveProduction(auth, production)) {
    throw new ForbiddenError("video production approval is not allowed");
  }
  return detail;
}

conversationsRoutes.get("/", async (c) => {
  const auth = getAuth(c);
  return c.json(await listConversations(auth));
});

conversationsRoutes.post("/", zValidator("json", createSchema), async (c) => {
  const auth = getAuth(c);
  const body = c.req.valid("json");
  const row = await createConversation(auth, body);
  return c.json(row, 201);
});

conversationsRoutes.get("/:conversationId", async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  const detail = await getConversation(auth, conversationId);
  const activeRunId = await activeAgentStreamRunId(conversationId);
  return c.json({ ...detail, active_run_id: activeRunId });
});

conversationsRoutes.get("/:conversationId/context", async (c) => {
  return c.json(
    await getConversationContext(getAuth(c), c.req.param("conversationId")),
  );
});

conversationsRoutes.get("/:conversationId/documents/:documentId", async (c) => {
  const auth = getAuth(c);
  return c.json(
    await getConversationDocument(
      auth,
      c.req.param("conversationId"),
      c.req.param("documentId"),
    ),
  );
});

conversationsRoutes.get("/:conversationId/files/detail", async (c) => {
  const path = c.req.query("path");
  if (!path) throw new NotFoundError("file path is required");
  return c.json(
    await getConversationFile(getAuth(c), c.req.param("conversationId"), path),
  );
});

conversationsRoutes.get("/:conversationId/files/source", async (c) => {
  const path = c.req.query("path");
  if (!path) throw new NotFoundError("file path is required");
  const file = await getConversationFile(
    getAuth(c),
    c.req.param("conversationId"),
    path,
  );
  return new Response(file.content, {
    headers: {
      "Content-Type": `${file.mime_type}; charset=utf-8`,
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
});

conversationsRoutes.get("/:conversationId/video-productions/:productionId", async (c) => {
  const auth = getAuth(c);
  return c.json(await authorizedProduction(
    auth,
    c.req.param("conversationId"),
    c.req.param("productionId"),
  ));
});

conversationsRoutes.post(
  "/:conversationId/video-productions/:productionId/decisions",
  zValidator("json", productionDecisionSchema),
  async (c) => {
    const auth = getAuth(c);
    const productionId = c.req.param("productionId");
    await authorizedProduction(auth, c.req.param("conversationId"), productionId);
    const body = c.req.valid("json");
    const common = {
      actionId: body.action_id,
      expectedVersion: body.expected_version,
      actorId: auth.userId,
    };
    let decision: ProductionDecision;
    if (body.action === "approve_storyboard") {
      decision = {
          action: body.action,
          ...common,
          budgetLimitMicros: body.budget_limit_micros,
          currency: body.currency,
        };
    } else if (body.action === "revise_storyboard") {
      decision = {
        action: body.action,
        ...common,
        shotPlan: body.shot_plan,
      };
    } else if (body.action === "request_take") {
      decision = { action: body.action, ...common, shotId: body.shot_id };
    } else if (body.action === "approve_takes") {
      decision = {
        action: body.action,
        ...common,
        selections: body.selections.map((selection) => ({
          shotId: selection.shot_id,
          takeId: selection.take_id,
        })),
      };
    } else if (body.action === "approve_publish") {
      decision = {
        action: body.action,
        ...common,
        ...(body.waiver_reason ? { waiverReason: body.waiver_reason } : {}),
      };
    } else {
      decision = { action: body.action, ...common, reason: body.reason };
    }
    return c.json(await decideVideoProduction(productionId, decision));
  },
);

conversationsRoutes.get(
  "/:conversationId/video-productions/:productionId/preview",
  async (c) => {
    const auth = getAuth(c);
    const detail = await authorizedProduction(
      auth,
      c.req.param("conversationId"),
      c.req.param("productionId"),
    );
    const stagedMediaId = detail.production.stagedMediaId;
    if (!stagedMediaId) throw new NotFoundError("video production preview is not available");
    const source = await getStagedMediaSource(detail.production.userId, stagedMediaId);
    const body = source.bytes.buffer.slice(
      source.bytes.byteOffset,
      source.bytes.byteOffset + source.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, { headers: { "Content-Type": source.mimeType } });
  },
);

conversationsRoutes.get(
  "/:conversationId/video-productions/:productionId/shots/:shotId/takes/:takeId/preview",
  async (c) => {
    const auth = getAuth(c);
    const detail = await authorizedProduction(
      auth,
      c.req.param("conversationId"),
      c.req.param("productionId"),
    );
    const review = detail.production.shotReviews.find(
      (candidate) => candidate.shotId === c.req.param("shotId"),
    );
    const take = review?.takes.find((candidate) => candidate.id === c.req.param("takeId"));
    if (!take?.stagedMediaId) throw new NotFoundError("video take preview is not available");
    const source = await getStagedMediaSource(detail.production.userId, take.stagedMediaId);
    const body = source.bytes.buffer.slice(
      source.bytes.byteOffset,
      source.bytes.byteOffset + source.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, { headers: { "Content-Type": source.mimeType } });
  },
);

conversationsRoutes.get("/:conversationId/documents/:documentId/source", async (c) => {
  const auth = getAuth(c);
  const maxDimRaw = c.req.query("max_dim");
  const parsedMaxDim = maxDimRaw ? Number.parseInt(maxDimRaw, 10) : Number.NaN;
  const maxDim =
    Number.isFinite(parsedMaxDim) && parsedMaxDim > 0 ? parsedMaxDim : undefined;
  const source = await getConversationDocumentSource(
    auth,
    c.req.param("conversationId"),
    c.req.param("documentId"),
    maxDim ? { maxDim } : undefined,
  );
  const body = source.bytes.buffer.slice(
    source.bytes.byteOffset,
    source.bytes.byteOffset + source.bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: { "Content-Type": source.mimeType },
  });
});

conversationsRoutes.patch("/:conversationId", zValidator("json", updateSchema), async (c) => {
  const auth = getAuth(c);
  const body = c.req.valid("json");
  return c.json(await updateConversation(auth, c.req.param("conversationId"), body));
});


conversationsRoutes.patch(
  "/:conversationId/documents/:documentId",
  zValidator("json", updateDocumentSchema),
  async (c) => {
    const auth = getAuth(c);
    const body = c.req.valid("json");
    return c.json(
      await updateConversationDocument(
        auth,
        c.req.param("conversationId"),
        c.req.param("documentId"),
        body,
      ),
    );
  },
);

conversationsRoutes.delete("/:conversationId", async (c) => {
  const auth = getAuth(c);
  await deleteConversation(auth, c.req.param("conversationId"));
  return c.body(null, 204);
});

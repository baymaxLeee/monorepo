import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import { getConversationContext } from "../../../application/agent/index.js";
import { activeAgentStreamRunId } from "../../../application/agent/streams/service.js";
import { forkConversation } from "../../../application/conversation-fork.js";
import {
  authorizeDocumentDelivery,
  authorizeConversationSourceDelivery,
  authorizeFileDelivery,
  createConversation,
  deleteConversation,
  getConversation,
  getConversationDocument,
  getConversationFile,
  listConversations,
  selectConversationHistory,
  updateConversation,
  updateConversationDocument,
  updateConversationFileContent,
} from "../../../application/conversations.js";
import { ForbiddenError, NotFoundError } from "../../../application/errors.js";
import { editableFileByteLimit } from "../../../application/file-edit-limits.js";
import {
  decideVideoProduction,
  getVideoProduction,
  type ProductionDecision,
} from "../../../infrastructure/clients/executor.js";
import { getStagedMediaDelivery } from "../../../infrastructure/clients/knowledge.js";
import { getAuth } from "../middleware/auth.js";

export const conversationsRoutes = new Hono();

conversationsRoutes.post(
  "/canvas",
  zValidator(
    "json",
    z.object({
      project_id: z.string().min(1).max(36),
      canvas_id: z.string().min(1).max(36),
      title: z.string().min(1).max(200).optional(),
    }),
  ),
  async (c) => {
    const conversation = await createConversation(getAuth(c), c.req.valid("json"));
    return c.json(
      { id: conversation.id, project_id: conversation.project_id!, canvas_id: conversation.canvas_id! },
      201,
    );
  },
);

const createSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  provider_id: z.string().max(32).optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

const selectHistorySchema = z.object({
  leaf_message_id: z.string().min(1).max(32),
  expected_revision: z.number().int().nonnegative(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content_md: z.string().optional(),
});

const updateFileContentSchema = z.object({
  content: z.string(),
  expected_etag: z.string().regex(/^"[a-f0-9]{32}"$/),
  operation_id: z.string().min(1).max(80),
});

const shotPlanInputSchema = z.object({
  version: z.number().int().positive(),
  shots: z
    .array(
      z.object({
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
        references: z
          .array(
            z.object({
              id: z.string().min(1).max(80),
              mediaType: z.enum(["image", "video", "audio"]),
              purpose: z.string().min(1).max(120),
              documentId: z.string().max(32).optional(),
              url: z.string().url().optional(),
              licenseStatus: z.enum(["verified", "user_attested", "missing"]),
              consentStatus: z.enum(["not_applicable", "verified", "user_attested", "missing"]),
            }),
          )
          .max(15),
        continuityContract: z.array(z.string().min(1).max(300)).max(20),
        acceptanceCriteria: z.array(z.string().min(1).max(1_200)).min(1).max(20),
      }),
    )
    .min(1)
    .max(12),
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
    selections: z
      .array(
        z.object({
          shot_id: z.string().min(1).max(80),
          take_id: z.string().min(1).max(80),
        }),
      )
      .min(1)
      .max(12),
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
  production: { userId?: string; workspaceId?: string },
): boolean {
  if (production.userId === auth.userId) {
    return true;
  }
  if (production.workspaceId !== auth.workspaceId) {
    return false;
  }
  return (
    auth.workspaceRole === "owner" || auth.workspaceRole === "admin" || auth.roles.includes("video_production.approve")
  );
}

async function authorizedProduction(auth: ReturnType<typeof getAuth>, conversationId: string, productionId: string) {
  const detail = await getVideoProduction(productionId);
  const production = detail.production;
  if (production.conversationId !== conversationId || production.workspaceId !== auth.workspaceId) {
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

conversationsRoutes.post("/:conversationId/history/select", zValidator("json", selectHistorySchema), async (c) => {
  return c.json(await selectConversationHistory(getAuth(c), c.req.param("conversationId"), c.req.valid("json")));
});

conversationsRoutes.get("/:conversationId/context", async (c) => {
  return c.json(await getConversationContext(getAuth(c), c.req.param("conversationId")));
});

conversationsRoutes.get("/:conversationId/documents/:documentId", async (c) => {
  const auth = getAuth(c);
  return c.json(
    await getConversationDocument(
      auth,
      c.req.param("conversationId"),
      c.req.param("documentId"),
      c.req.query("include_content") !== "false",
    ),
  );
});

conversationsRoutes.get("/:conversationId/files/:fileId", async (c) => {
  const file = await getConversationFile(getAuth(c), c.req.param("conversationId"), c.req.param("fileId"));
  c.header("ETag", file.etag);
  c.header("Cache-Control", "no-store");
  return c.json(file);
});

conversationsRoutes.patch(
  "/:conversationId/files/:fileId/content",
  // JSON may encode one byte as six ASCII characters (\u0000).
  async (c, next) => bodyLimit({ maxSize: editableFileByteLimit() * 6 + 1024 })(c, next),
  zValidator("json", updateFileContentSchema),
  async (c) => {
    const body = c.req.valid("json");
    const file = await updateConversationFileContent(getAuth(c), c.req.param("conversationId"), c.req.param("fileId"), {
      content: body.content,
      expectedEtag: body.expected_etag,
      operationId: body.operation_id,
      signal: c.req.raw.signal,
    });
    c.header("ETag", file.etag);
    c.header("Cache-Control", "no-store");
    return c.json(file);
  },
);

conversationsRoutes.get("/:conversationId/video-productions/:productionId", async (c) => {
  const auth = getAuth(c);
  return c.json(await authorizedProduction(auth, c.req.param("conversationId"), c.req.param("productionId")));
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

conversationsRoutes.get("/:conversationId/video-productions/:productionId/preview-url", async (c) => {
  const auth = getAuth(c);
  const detail = await authorizedProduction(auth, c.req.param("conversationId"), c.req.param("productionId"));
  const stagedMediaId = detail.production.stagedMediaId;
  if (!stagedMediaId) {
    throw new NotFoundError("video production preview is not available");
  }
  return c.json(await getStagedMediaDelivery(detail.production.userId, stagedMediaId));
});

conversationsRoutes.get(
  "/:conversationId/video-productions/:productionId/shots/:shotId/takes/:takeId/preview-url",
  async (c) => {
    const auth = getAuth(c);
    const detail = await authorizedProduction(auth, c.req.param("conversationId"), c.req.param("productionId"));
    const review = detail.production.shotReviews.find((candidate) => candidate.shotId === c.req.param("shotId"));
    const take = review?.takes.find((candidate) => candidate.id === c.req.param("takeId"));
    if (!take?.stagedMediaId) {
      throw new NotFoundError("video take preview is not available");
    }
    return c.json(await getStagedMediaDelivery(detail.production.userId, take.stagedMediaId));
  },
);

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
      await updateConversationDocument(auth, c.req.param("conversationId"), c.req.param("documentId"), body),
    );
  },
);

conversationsRoutes.delete("/:conversationId", async (c) => {
  const auth = getAuth(c);
  await deleteConversation(auth, c.req.param("conversationId"));
  return c.body(null, 204);
});

conversationsRoutes.post("/:conversationId/documents/:documentId/delivery", async (c) => {
  const raw = c.req.query("max_dim");
  const maxDim = raw === undefined ? undefined : Number(raw);
  if (maxDim !== undefined && (!Number.isInteger(maxDim) || maxDim < 1 || maxDim > 4096)) {
    return c.json({ title: "invalid max_dim", status: 400 }, 400);
  }
  return c.json(
    await authorizeDocumentDelivery(getAuth(c), c.req.param("conversationId"), c.req.param("documentId"), maxDim),
  );
});
conversationsRoutes.post("/:conversationId/files/:fileId/delivery", async (c) => {
  return c.json(
    await authorizeFileDelivery(
      getAuth(c),
      c.req.param("conversationId"),
      c.req.param("fileId"),
      c.req.query("revision_id"),
    ),
  );
});
conversationsRoutes.get("/:conversationId/files/:fileId/content", async (c) => {
  const capability = await authorizeFileDelivery(getAuth(c), c.req.param("conversationId"), c.req.param("fileId"));
  c.header("Cache-Control", "no-store");
  return c.redirect(capability.url, 307);
});
conversationsRoutes.get("/:conversationId/documents/:documentId/content", async (c) => {
  const capability = await authorizeDocumentDelivery(
    getAuth(c),
    c.req.param("conversationId"),
    c.req.param("documentId"),
  );
  c.header("Cache-Control", "no-store");
  return c.redirect(capability.url, 307);
});
conversationsRoutes.post("/:conversationId/sources/:sourceId/delivery", async (c) => {
  const capability = await authorizeConversationSourceDelivery(
    getAuth(c),
    c.req.param("conversationId"),
    c.req.param("sourceId"),
  );
  c.header("Cache-Control", "no-store");
  return c.json(capability);
});

conversationsRoutes.post(
  "/:conversationId/forks",
  zValidator("json", z.object({ message_id: z.string().min(1).max(32) })),
  async (c) => {
    return c.json(
      await forkConversation(getAuth(c), c.req.param("conversationId"), c.req.valid("json").message_id),
      201,
    );
  },
);

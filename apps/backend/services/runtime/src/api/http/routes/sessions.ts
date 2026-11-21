import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import { getSessionContext } from "../../../application/agent/index.js";
import { activeAgentStreamRunId } from "../../../application/agent/streams/service.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../../application/errors.js";
import { editableFileByteLimit } from "../../../application/file-edit-limits.js";
import { completeSessionAttachment, prepareSessionAttachment } from "../../../application/session-attachments.js";
import { forkSession } from "../../../application/session-fork.js";
import {
  authorizeDocumentDelivery,
  authorizeSessionSourceDelivery,
  authorizeFileDelivery,
  createSession,
  deleteSession,
  getSession,
  getSessionDocument,
  getSessionFile,
  listSessions,
  selectSessionHistory,
  updateSessionDocument,
  updateSessionFileContent,
  updateSessionExecutionPolicy,
  updateSessionModel,
} from "../../../application/sessions.js";
import { getProvider } from "../../../infrastructure/clients/admin.js";
import { getStagedMediaDelivery } from "../../../infrastructure/clients/knowledge.js";
import {
  decideVideoProduction,
  getVideoProduction,
  type ProductionDecision,
} from "../../../infrastructure/clients/worker.js";
import { prepareAttachmentSchema, completeAttachmentSchema } from "../attachment-schemas.js";
import { getAuth } from "../middleware/auth.js";

export const sessionsRoutes = new Hono();

const reasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const approvalPolicySchema = z.enum(["never", "on-request", "unless-trusted", "granular"]);
const permissionProfileSchema = z.enum([":read-only", ":workspace", ":danger-full-access"]);

const createSchema = z.object({
  request_id: z.string().min(8).max(64),
  provider_id: z.string().max(32).optional().nullable(),
  reasoning_effort: reasoningEffortSchema.optional().nullable(),
  approval_policy: approvalPolicySchema.optional().nullable(),
  permission_profile: permissionProfileSchema.optional().nullable(),
});

const updateModelSchema = z.object({
  provider_id: z.string().min(1).max(32),
  reasoning_effort: reasoningEffortSchema,
});

const updateExecutionPolicySchema = z.object({
  approval_policy: approvalPolicySchema,
  permission_profile: permissionProfileSchema,
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

async function authorizedProduction(auth: ReturnType<typeof getAuth>, sessionId: string, productionId: string) {
  const detail = await getVideoProduction(productionId);
  const production = detail.production;
  if (production.sessionId !== sessionId || production.workspaceId !== auth.workspaceId) {
    throw new NotFoundError(`video production ${productionId} not found in session ${sessionId}`);
  }
  if (!canApproveProduction(auth, production)) {
    throw new ForbiddenError("video production approval is not allowed");
  }
  return detail;
}

sessionsRoutes.get("/", async (c) => {
  const auth = getAuth(c);
  return c.json(await listSessions(auth));
});

sessionsRoutes.post("/", zValidator("json", createSchema), async (c) => {
  const auth = getAuth(c);
  const body = c.req.valid("json");
  const provider = body.provider_id ? await getProvider(auth.tenantId, auth.workspaceId, body.provider_id) : null;
  const row = await createSession(auth, {
    ...body,
    model: provider?.model ?? null,
  });
  return c.json(row, 201);
});

sessionsRoutes.get("/:sessionId", async (c) => {
  const auth = getAuth(c);
  const sessionId = c.req.param("sessionId");
  const detail = await getSession(auth, sessionId);
  const activeRunId = await activeAgentStreamRunId(sessionId);
  return c.json({ ...detail, active_run_id: activeRunId });
});

sessionsRoutes.patch("/:sessionId/model", zValidator("json", updateModelSchema), async (c) => {
  const auth = getAuth(c);
  const sessionId = c.req.param("sessionId");
  const activeRunId = await activeAgentStreamRunId(sessionId);
  if (activeRunId) {
    throw new ConflictError("conversation model cannot change while a run is active", "active_run_exists", {
      run_id: activeRunId,
    });
  }
  const body = c.req.valid("json");
  const provider = await getProvider(auth.tenantId, auth.workspaceId, body.provider_id);
  return c.json(
    await updateSessionModel(auth, sessionId, {
      providerId: provider.id,
      model: provider.model,
      reasoningEffort: body.reasoning_effort,
    }),
  );
});

sessionsRoutes.patch("/:sessionId/execution-policy", zValidator("json", updateExecutionPolicySchema), async (c) => {
  const auth = getAuth(c);
  const sessionId = c.req.param("sessionId");
  const activeRunId = await activeAgentStreamRunId(sessionId);
  if (activeRunId) {
    throw new ConflictError("conversation execution policy cannot change while a run is active", "active_run_exists", {
      run_id: activeRunId,
    });
  }
  const body = c.req.valid("json");
  return c.json(
    await updateSessionExecutionPolicy(auth, sessionId, {
      approvalPolicy: body.approval_policy,
      permissionProfile: body.permission_profile,
    }),
  );
});

sessionsRoutes.post("/:sessionId/history/select", zValidator("json", selectHistorySchema), async (c) => {
  return c.json(await selectSessionHistory(getAuth(c), c.req.param("sessionId"), c.req.valid("json")));
});

sessionsRoutes.get("/:sessionId/context", async (c) => {
  return c.json(await getSessionContext(getAuth(c), c.req.param("sessionId")));
});

sessionsRoutes.post("/:sessionId/attachments/prepare", zValidator("json", prepareAttachmentSchema), async (c) =>
  c.json(await prepareSessionAttachment(getAuth(c), c.req.param("sessionId"), c.req.valid("json"))),
);
sessionsRoutes.post("/:sessionId/attachments/complete", zValidator("json", completeAttachmentSchema), async (c) =>
  c.json(await completeSessionAttachment(getAuth(c), c.req.param("sessionId"), c.req.valid("json"))),
);

sessionsRoutes.get("/:sessionId/documents/:documentId", async (c) => {
  const auth = getAuth(c);
  return c.json(
    await getSessionDocument(
      auth,
      c.req.param("sessionId"),
      c.req.param("documentId"),
      c.req.query("include_content") !== "false",
    ),
  );
});

sessionsRoutes.get("/:sessionId/files/:fileId", async (c) => {
  const file = await getSessionFile(getAuth(c), c.req.param("sessionId"), c.req.param("fileId"));
  c.header("ETag", file.etag);
  c.header("Cache-Control", "no-store");
  return c.json(file);
});

sessionsRoutes.patch(
  "/:sessionId/files/:fileId/content",
  // JSON may encode one byte as six ASCII characters (\u0000).
  async (c, next) => bodyLimit({ maxSize: editableFileByteLimit() * 6 + 1024 })(c, next),
  zValidator("json", updateFileContentSchema),
  async (c) => {
    const body = c.req.valid("json");
    const file = await updateSessionFileContent(getAuth(c), c.req.param("sessionId"), c.req.param("fileId"), {
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

sessionsRoutes.get("/:sessionId/video-productions/:productionId", async (c) => {
  const auth = getAuth(c);
  return c.json(await authorizedProduction(auth, c.req.param("sessionId"), c.req.param("productionId")));
});

sessionsRoutes.post(
  "/:sessionId/video-productions/:productionId/decisions",
  zValidator("json", productionDecisionSchema),
  async (c) => {
    const auth = getAuth(c);
    const productionId = c.req.param("productionId");
    await authorizedProduction(auth, c.req.param("sessionId"), productionId);
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

sessionsRoutes.get("/:sessionId/video-productions/:productionId/preview-url", async (c) => {
  const auth = getAuth(c);
  const detail = await authorizedProduction(auth, c.req.param("sessionId"), c.req.param("productionId"));
  const stagedMediaId = detail.production.stagedMediaId;
  if (!stagedMediaId) {
    throw new NotFoundError("video production preview is not available");
  }
  return c.json(await getStagedMediaDelivery(detail.production.userId, stagedMediaId));
});

sessionsRoutes.get("/:sessionId/video-productions/:productionId/shots/:shotId/takes/:takeId/preview-url", async (c) => {
  const auth = getAuth(c);
  const detail = await authorizedProduction(auth, c.req.param("sessionId"), c.req.param("productionId"));
  const review = detail.production.shotReviews.find((candidate) => candidate.shotId === c.req.param("shotId"));
  const take = review?.takes.find((candidate) => candidate.id === c.req.param("takeId"));
  if (!take?.stagedMediaId) {
    throw new NotFoundError("video take preview is not available");
  }
  return c.json(await getStagedMediaDelivery(detail.production.userId, take.stagedMediaId));
});

sessionsRoutes.patch("/:sessionId/documents/:documentId", zValidator("json", updateDocumentSchema), async (c) => {
  const auth = getAuth(c);
  const body = c.req.valid("json");
  return c.json(await updateSessionDocument(auth, c.req.param("sessionId"), c.req.param("documentId"), body));
});

sessionsRoutes.delete("/:sessionId", async (c) => {
  const auth = getAuth(c);
  await deleteSession(auth, c.req.param("sessionId"));
  return c.body(null, 204);
});

const deliveryQuery = z.object({
  max_dim: z.coerce.number().int().min(1).max(4096).optional(),
  revision_id: z.string().optional(),
});
sessionsRoutes.post("/:sessionId/documents/:documentId/delivery", zValidator("query", deliveryQuery), async (c) => {
  const maxDim = c.req.valid("query").max_dim;
  return c.json(
    await authorizeDocumentDelivery(getAuth(c), c.req.param("sessionId"), c.req.param("documentId"), maxDim),
  );
});
sessionsRoutes.post("/:sessionId/files/:fileId/delivery", zValidator("query", deliveryQuery), async (c) => {
  return c.json(
    await authorizeFileDelivery(
      getAuth(c),
      c.req.param("sessionId"),
      c.req.param("fileId"),
      c.req.valid("query").revision_id,
      c.req.valid("query").max_dim,
    ),
  );
});
sessionsRoutes.get("/:sessionId/files/:fileId/content", async (c) => {
  const capability = await authorizeFileDelivery(getAuth(c), c.req.param("sessionId"), c.req.param("fileId"));
  c.header("Cache-Control", "no-store");
  return c.redirect(capability.url, 307);
});
sessionsRoutes.get("/:sessionId/documents/:documentId/content", async (c) => {
  const capability = await authorizeDocumentDelivery(getAuth(c), c.req.param("sessionId"), c.req.param("documentId"));
  c.header("Cache-Control", "no-store");
  return c.redirect(capability.url, 307);
});
sessionsRoutes.post("/:sessionId/sources/:sourceId/delivery", async (c) => {
  const capability = await authorizeSessionSourceDelivery(
    getAuth(c),
    c.req.param("sessionId"),
    c.req.param("sourceId"),
  );
  c.header("Cache-Control", "no-store");
  return c.json(capability);
});

sessionsRoutes.post(
  "/:sessionId/forks",
  zValidator("json", z.object({ message_id: z.string().min(1).max(32) })),
  async (c) => {
    return c.json(await forkSession(getAuth(c), c.req.param("sessionId"), c.req.valid("json").message_id), 201);
  },
);

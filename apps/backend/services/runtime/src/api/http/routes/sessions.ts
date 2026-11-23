import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import { getSessionContext } from "../../../application/agent/index.js";
import { activeAgentStreamRunId } from "../../../application/agent/streams/service.js";
import { ConflictError } from "../../../application/errors.js";
import { editableFileByteLimit } from "../../../application/file-edit-limits.js";
import { completeSessionAttachment, prepareSessionAttachment } from "../../../application/session-attachments.js";
import { forkSession } from "../../../application/session-fork.js";
import {
  authorizeFileDelivery,
  createSession,
  deleteSession,
  getSession,
  getSessionFile,
  selectSessionHistory,
  updateSessionExecutionPolicy,
  updateSessionFileContent,
  updateSessionModel,
} from "../../../application/sessions.js";
import { completeAttachmentSchema, prepareAttachmentSchema } from "../attachment-schemas.js";

export const sessionsRoutes = new Hono();

const reasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const approvalPolicySchema = z.enum(["never", "on-request", "unless-trusted", "granular"]);
const permissionProfileSchema = z.enum([":read-only", ":workspace", ":danger-full-access"]);

const createSchema = z
  .object({
    request_id: z.string().min(8).max(64),
    provider_id: z.string().max(32).optional().nullable(),
    model: z.string().max(120).optional().nullable(),
    reasoning_effort: reasoningEffortSchema.optional().nullable(),
    approval_policy: approvalPolicySchema.optional().nullable(),
    permission_profile: permissionProfileSchema.optional().nullable(),
  })
  .strict();

const updateModelSchema = z
  .object({
    provider_id: z.string().min(1).max(32),
    model: z.string().min(1).max(120),
    reasoning_effort: reasoningEffortSchema,
  })
  .strict();

const updateExecutionPolicySchema = z
  .object({
    approval_policy: approvalPolicySchema,
    permission_profile: permissionProfileSchema,
  })
  .strict();

const selectHistorySchema = z
  .object({
    leaf_message_id: z.string().min(1).max(32),
    expected_revision: z.number().int().nonnegative(),
  })
  .strict();

const updateFileContentSchema = z
  .object({
    content: z.string(),
    expected_etag: z.string().regex(/^"[a-f0-9]{32}"$/),
    operation_id: z.string().min(1).max(80),
  })
  .strict();

sessionsRoutes.post("/", zValidator("json", createSchema), async (c) =>
  c.json(await createSession(c.req.valid("json")), 201),
);

sessionsRoutes.get("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const detail = await getSession(sessionId);
  const activeRunId = await activeAgentStreamRunId(sessionId);
  return c.json({ ...detail, active_run_id: activeRunId });
});

sessionsRoutes.patch("/:sessionId/model", zValidator("json", updateModelSchema), async (c) => {
  const sessionId = c.req.param("sessionId");
  const activeRunId = await activeAgentStreamRunId(sessionId);
  if (activeRunId) {
    throw new ConflictError("session model cannot change while a Turn is active", "active_run_exists", {
      run_id: activeRunId,
    });
  }
  const body = c.req.valid("json");
  return c.json(
    await updateSessionModel(sessionId, {
      providerId: body.provider_id,
      model: body.model,
      reasoningEffort: body.reasoning_effort,
    }),
  );
});

sessionsRoutes.patch("/:sessionId/execution-policy", zValidator("json", updateExecutionPolicySchema), async (c) => {
  const sessionId = c.req.param("sessionId");
  const activeRunId = await activeAgentStreamRunId(sessionId);
  if (activeRunId) {
    throw new ConflictError("session execution policy cannot change while a Turn is active", "active_run_exists", {
      run_id: activeRunId,
    });
  }
  const body = c.req.valid("json");
  return c.json(
    await updateSessionExecutionPolicy(sessionId, {
      approvalPolicy: body.approval_policy,
      permissionProfile: body.permission_profile,
    }),
  );
});

sessionsRoutes.post("/:sessionId/history/select", zValidator("json", selectHistorySchema), async (c) =>
  c.json(await selectSessionHistory(c.req.param("sessionId"), c.req.valid("json"))),
);

sessionsRoutes.get("/:sessionId/context", async (c) => c.json(await getSessionContext(c.req.param("sessionId"))));

sessionsRoutes.post("/:sessionId/attachments/prepare", zValidator("json", prepareAttachmentSchema), async (c) =>
  c.json(await prepareSessionAttachment(c.req.param("sessionId"), c.req.valid("json"))),
);

sessionsRoutes.post("/:sessionId/attachments/complete", zValidator("json", completeAttachmentSchema), async (c) =>
  c.json(await completeSessionAttachment(c.req.param("sessionId"), c.req.valid("json"))),
);

sessionsRoutes.get("/:sessionId/files/:fileId", async (c) => {
  const file = await getSessionFile(c.req.param("sessionId"), c.req.param("fileId"));
  c.header("ETag", file.etag);
  c.header("Cache-Control", "no-store");
  return c.json(file);
});

sessionsRoutes.patch(
  "/:sessionId/files/:fileId/content",
  async (c, next) => bodyLimit({ maxSize: editableFileByteLimit() * 6 + 1024 })(c, next),
  zValidator("json", updateFileContentSchema),
  async (c) => {
    const body = c.req.valid("json");
    const file = await updateSessionFileContent(c.req.param("sessionId"), c.req.param("fileId"), {
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

const deliveryQuery = z.object({
  max_dim: z.coerce.number().int().min(1).max(4096).optional(),
  revision_id: z.string().optional(),
});

sessionsRoutes.post("/:sessionId/files/:fileId/delivery", zValidator("query", deliveryQuery), async (c) =>
  c.json(
    await authorizeFileDelivery(
      c.req.param("sessionId"),
      c.req.param("fileId"),
      c.req.valid("query").revision_id,
      c.req.valid("query").max_dim,
    ),
  ),
);

sessionsRoutes.get("/:sessionId/files/:fileId/content", async (c) => {
  const capability = await authorizeFileDelivery(c.req.param("sessionId"), c.req.param("fileId"));
  c.header("Cache-Control", "no-store");
  return c.redirect(capability.url, 307);
});

sessionsRoutes.post(
  "/:sessionId/forks",
  zValidator("json", z.object({ message_id: z.string().min(1).max(32) }).strict()),
  async (c) => c.json(await forkSession(c.req.param("sessionId"), c.req.valid("json").message_id), 201),
);

sessionsRoutes.delete("/:sessionId", async (c) => {
  await deleteSession(c.req.param("sessionId"));
  return c.body(null, 204);
});

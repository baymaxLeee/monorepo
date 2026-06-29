import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { NotFoundError } from "../lib/errors.js";
import { getAuth } from "../middleware/auth.js";
import {
  approveCandidate,
  deleteMemory,
  listActiveMemories,
  listPendingCandidates,
  rejectCandidate,
  updateCandidate,
} from "../services/agent/index.js";

export const memoriesRoutes = new Hono();

const patchSchema = z.object({
  category: z.enum(["preference", "profile", "project", "instruction"]).optional(),
  content: z.string().min(5).max(500).optional(),
}).refine((value) => value.category !== undefined || value.content !== undefined, {
  message: "at least one field is required",
});

memoriesRoutes.get("/", async (c) => {
  const auth = getAuth(c);
  const memories = await listActiveMemories(auth.userId);
  return c.json({ memories });
});

memoriesRoutes.get("/candidates", async (c) => {
  const auth = getAuth(c);
  const candidates = await listPendingCandidates(auth.userId);
  return c.json({ candidates });
});

memoriesRoutes.post("/candidates/:id/approve", async (c) => {
  const auth = getAuth(c);
  const memory = await approveCandidate(auth.userId, c.req.param("id"));
  if (!memory) throw new NotFoundError("memory candidate not found");
  return c.json({ memory });
});

memoriesRoutes.post("/candidates/:id/reject", async (c) => {
  const auth = getAuth(c);
  const ok = await rejectCandidate(auth.userId, c.req.param("id"));
  if (!ok) throw new NotFoundError("memory candidate not found");
  return c.json({ rejected: true });
});

memoriesRoutes.patch("/candidates/:id", zValidator("json", patchSchema), async (c) => {
  const auth = getAuth(c);
  const candidate = await updateCandidate(auth.userId, c.req.param("id"), c.req.valid("json"));
  if (!candidate) throw new NotFoundError("memory candidate not found");
  return c.json({ candidate });
});

memoriesRoutes.delete("/:id", async (c) => {
  const auth = getAuth(c);
  const ok = await deleteMemory(auth.userId, c.req.param("id"));
  if (!ok) throw new NotFoundError("memory not found");
  return c.json({ deleted: true });
});

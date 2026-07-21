import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { decideVideoProduction } from "../../../application/video-production/decisions.js";
import { getVideoProduction } from "../../../application/video-production/service.js";
import { productionDecisionSchema } from "../../../domain/video-production/contracts.js";
import { requireCallerService } from "../middleware/auth.js";

export const videoProductionRoutes = new Hono();

videoProductionRoutes.get("/:id", async (c) => {
  const caller = requireCallerService(c);
  return c.json(await getVideoProduction(c.req.param("id"), caller));
});

videoProductionRoutes.post(
  "/:id/decisions",
  zValidator("json", productionDecisionSchema),
  async (c) => {
    const caller = requireCallerService(c);
    const production = await decideVideoProduction(
      c.req.param("id"),
      caller,
      c.req.valid("json"),
    );
    return c.json(production);
  },
);

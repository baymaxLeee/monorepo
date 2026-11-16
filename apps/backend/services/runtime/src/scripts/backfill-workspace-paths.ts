import { backfillWorkspacePaths, verifyWorkspacePathBackfill } from "../application/workspace-path-backfill.js";
import { getSql } from "../infrastructure/persistence/index.js";

try {
  const result = await backfillWorkspacePaths();
  const verified = await verifyWorkspacePathBackfill();
  process.stdout.write(`${JSON.stringify({ ...result, verified })}\n`);
} finally {
  await getSql().end({ timeout: 5 });
}

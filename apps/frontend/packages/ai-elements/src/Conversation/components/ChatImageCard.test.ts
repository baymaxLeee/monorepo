import { expect, test } from "vitest";

import { parseGenerateImageOutput } from "./ChatImageCard";

test("durable image submission is terminal for the tool without pretending images exist", () => {
  const parsed = parseGenerateImageOutput({
    ok: true,
    status: "completed",
    data: { kind: "image", task_id: "task-id", count: 2 },
  });

  expect(parsed).toMatchObject({
    ok: true,
    status: "completed",
    taskId: "task-id",
    count: 2,
    images: [],
  });
});

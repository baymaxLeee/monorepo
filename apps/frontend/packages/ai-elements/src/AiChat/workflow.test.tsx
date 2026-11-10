import { render } from "@testing-library/react";
import { expect, test } from "vitest";

import { Task } from "./workflow";

test("workflow tasks delegate their semantic state to Trace", () => {
  const { container } = render(
    <>
      <Task status="running">运行中</Task>
      <Task status="completed">已完成</Task>
      <Task status="failed">失败</Task>
      <Task status="cancelled">已取消</Task>
      <Task status="pending">等待中</Task>
    </>,
  );
  const lines = container.querySelectorAll("[data-slot='trace-line']");

  expect([...lines].map((line) => line.getAttribute("data-status"))).toEqual([
    "running",
    "completed",
    "error",
    "cancelled",
    "pending",
  ]);
});

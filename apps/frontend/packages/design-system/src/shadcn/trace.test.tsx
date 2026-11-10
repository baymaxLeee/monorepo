import { render } from "@testing-library/react";
import { CheckIcon } from "lucide-react";
import { expect, test } from "vitest";

import { TraceIcon, TraceLine } from "./trace";

test("Trace owns session status icon colors", () => {
  const { container } = render(
    <TraceLine status="completed">
      <TraceIcon>
        <CheckIcon />
      </TraceIcon>
    </TraceLine>,
  );
  const line = container.querySelector("[data-slot='trace-line']");

  expect(line?.classList.contains("data-[status=completed]:*:data-[slot=trace-icon]:text-green-600")).toBe(true);
});

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ProjectSearchForm } from "./ProjectSearchForm";

test("native form submission returns the authorized project query and human filtering remains available", async () => {
  const response = { total: 1, projects: [{ id: "p1", name: "Atlas" }] };
  const search = vi.fn(async () => response);
  const change = vi.fn();
  render(<ProjectSearchForm value="Atlas" onChange={change} search={search} />);
  const form = screen.getByRole("search");
  expect(form.getAttribute("toolname")).toBe("search_canvas_projects");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "manual" } });
  expect(change).toHaveBeenCalledWith("manual");
  fireEvent.submit(form);
  expect(search).not.toHaveBeenCalled();
  const respondWith = vi.fn();
  const submission = Object.assign(new Event("submit", { bubbles: true, cancelable: true }), {
    agentInvoked: true,
    respondWith,
  });
  fireEvent(form, submission);
  expect(submission.defaultPrevented).toBe(true);
  expect(search).toHaveBeenCalledWith("Atlas");
  expect(await respondWith.mock.calls[0][0]).toEqual(response);
});

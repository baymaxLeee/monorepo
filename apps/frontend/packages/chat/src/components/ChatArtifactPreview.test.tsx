import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatArtifactPreview } from "./ChatArtifactPreview";

describe("conversation artifact rendering", () => {
  it.each(["text/html", "text/html; charset=utf-8", "Text/HTML"])(
    "renders raw HTML strings with MIME %s without a resource URL",
    (mimeType) => {
      const content = '<!doctype html><h1>Page</h1><script>console.log("ready")</script>';
      render(<ChatArtifactPreview title="Page" filename="page.html" mimeType={mimeType} content={content} />);
      const frame = screen.getByTitle("Page");
      expect(frame.tagName).toBe("IFRAME");
      expect(frame.getAttribute("srcdoc")).toBe(content);
      expect(frame.hasAttribute("src")).toBe(false);
      expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
      expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    },
  );

  it("renders Markdown through the existing Markdown renderer", async () => {
    render(<ChatArtifactPreview title="Notes" filename="notes.md" mimeType="text/markdown" content="# Findings" />);
    expect(await screen.findByRole("heading", { name: "Findings" })).toBeTruthy();
  });

  it.each(["script.py", "data.json", "notes.txt"])("uses a read-only CodeEditor for %s", async (filename) => {
    const { container } = render(
      <ChatArtifactPreview title="Source" filename={filename} mimeType="text/plain" content="original source" />,
    );
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    expect(container.querySelector(".cm-content")?.textContent).toContain("original source");
    expect(container.querySelector(".cm-content")?.getAttribute("aria-readonly")).toBe("true");
  });
});

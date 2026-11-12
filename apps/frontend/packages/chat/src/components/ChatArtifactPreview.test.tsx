import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useStorageResource } from "../hooks/useStorageResource";
import { ChatArtifactPreview } from "./ChatArtifactPreview";

vi.mock("../hooks/useStorageResource", () => ({ useStorageResource: vi.fn() }));

beforeEach(() => {
  vi.mocked(useStorageResource).mockReturnValue({
    key: "",
    loading: false,
    retry: vi.fn(),
    onResourceError: vi.fn(),
  });
});

describe("conversation artifact rendering", () => {
  it.each(["text/html", "text/html; charset=utf-8", "Text/HTML"])(
    "renders raw HTML strings with MIME %s without a resource URL",
    (mimeType) => {
      const content = '<!doctype html><h1>Page</h1><script>console.log("ready")</script>';
      render(<ChatArtifactPreview title="Page" filename="page.html" mimeType={mimeType} content={content} />);
      const frame = screen.getByTitle("Page");
      expect(frame.tagName).toBe("IFRAME");
      expect(frame.getAttribute("srcdoc")).toContain(content.slice(content.indexOf("<h1>")));
      expect(frame.getAttribute("srcdoc")).toContain("data-artifact-hidden-scrollbars");
      expect(frame.hasAttribute("src")).toBe(false);
      expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
      expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    },
  );

  it("loads stored HTML as srcDoc so its internal scrollbars can be hidden without disabling scrolling", () => {
    vi.mocked(useStorageResource).mockReturnValue({
      key: "asset:revision",
      loading: false,
      capability: {
        asset_id: "asset",
        revision_id: "revision",
        url: "https://storage.test/artifacts/page.html?signature=a&expires=1",
        expires_at: "2099-01-01T00:00:00.000Z",
        filename: "page.html",
        media_type: "text/html",
        size_bytes: 100,
      },
      content: "<!doctype html><html><body><main>Stored page</main></body></html>",
      retry: vi.fn(),
      onResourceError: vi.fn(),
    });
    render(
      <ChatArtifactPreview
        asset={{
          assetId: "asset",
          revisionId: "revision",
          owner: { kind: "conversation-file", conversationId: "conversation", fileId: "file" },
        }}
        title="Stored page"
        filename="page.html"
        mimeType="text/html"
        content=""
      />,
    );
    expect(useStorageResource).toHaveBeenCalledWith(expect.anything(), true);
    const frame = screen.getByTitle("Stored page");
    expect(frame.hasAttribute("src")).toBe(false);
    expect(frame.getAttribute("srcdoc")).toContain(
      '<base href="https://storage.test/artifacts/page.html?signature=a&amp;expires=1">',
    );
    expect(frame.getAttribute("srcdoc")).toContain("data-artifact-hidden-scrollbars");
    expect(frame.getAttribute("srcdoc")).toContain("Stored page");
  });

  it("renders Markdown table cells through the shared MarkdownEditor", async () => {
    const { container } = render(
      <ChatArtifactPreview
        title="Notes"
        filename="notes.md"
        mimeType="text/markdown"
        content={"| Item | Details |\n| --- | --- |\n| Table | **same parser** |"}
      />,
    );
    await waitFor(() => expect(container.querySelector(".markdown-editor table")).not.toBeNull());
    expect(container.querySelector(".markdown-editor")?.parentElement?.classList.contains("overflow-hidden")).toBe(
      true,
    );
    expect(screen.getByRole("cell", { name: "same parser" })).toBeTruthy();
    expect(container.querySelector("[data-streamdown]")).toBeNull();
  });

  it.each(["script.py", "data.json", "notes.txt"])("uses a read-only CodeEditor for %s", async (filename) => {
    const { container } = render(
      <ChatArtifactPreview title="Source" filename={filename} mimeType="text/plain" content="original source" />,
    );
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    expect(container.querySelector(".cm-editor")?.closest(".overflow-hidden")).not.toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain("original source");
    expect(container.querySelector(".cm-content")?.getAttribute("aria-readonly")).toBe("true");
  });
});

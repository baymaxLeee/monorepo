import { createStorageDownloadUrl, fetchAssetText, fetchConversationDocument } from "@repo/api";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ChatDocumentArtifactPanel } from "./ChatDocumentArtifactPanel";
import { ChatFileArtifactPanel } from "./ChatFileArtifactPanel";

const resourceUrl = "/api/storage-server/media/asset/revisions/revision/content?expires=2000000000&signature=signed";

vi.mock("@repo/api", () => ({
  fetchConversationDocument: vi.fn(async () => ({
    id: "document",
    title: "Generated page",
    filename: "page.html",
    mime_type: "text/html",
    content_md: "<h1>Generated page</h1>",
    kind: "artifact",
    asset_id: "asset",
    source_revision_id: "revision",
    updated_at: "2026-11-05T00:00:00Z",
  })),
  createStorageDownloadUrl: vi.fn(async () => ({
    url: resourceUrl,
    expires_at: new Date(Date.now() + 21600000).toISOString(),
  })),
  fetchConversationFile: vi.fn(async () => ({
    path: "page.HTML",
    asset_id: "asset",
    revision_id: "revision",
    filename: "page.HTML",
    title: "Legacy page",
    mime_type: "text/html; charset=utf-8",
    content: "<h1>Legacy page</h1>",
    sha256: "sha",
  })),
  fetchAssetText: vi.fn(async () => "# Editable plan"),
  fetchConversationDocumentSource: vi.fn(),
  updateConversationDocument: vi.fn(),
}));

vi.mock("../store/useChatStore", () => ({
  useChatStore: () => ({
    artifactPreview: {
      open: true,
      conversationId: "conversation",
      documentId: "document",
      path: "page.HTML",
      token: 1,
    },
    closeArtifactPreview: vi.fn(),
  }),
}));

it("loads metadata then previews HTML from the Asset capability URL", async () => {
  render(<ChatDocumentArtifactPanel />);
  const frame = await screen.findByTitle("Generated page");
  expect(frame.tagName).toBe("IFRAME");
  expect(frame.getAttribute("src")).toBe(resourceUrl);
  expect(frame.hasAttribute("srcdoc")).toBe(false);
  expect(fetchConversationDocument).toHaveBeenCalledWith(
    "conversation",
    "document",
    expect.objectContaining({ includeContent: false }),
  );
  expect(createStorageDownloadUrl).toHaveBeenCalled();
  expect(screen.queryByText("HTML 预览地址不可用，请重新打开预览。")).toBeNull();
});

it("renders migrated virtual files through the same Storage URL preview", async () => {
  render(<ChatFileArtifactPanel />);
  const frame = await screen.findByTitle("Legacy page");
  expect(frame.tagName).toBe("IFRAME");
  expect(frame.getAttribute("src")).toBe(resourceUrl);
  expect(frame.hasAttribute("srcdoc")).toBe(false);
});

it("loads an editable Markdown revision from Storage before opening the editor", async () => {
  vi.mocked(fetchConversationDocument).mockResolvedValueOnce({
    id: "plan",
    title: "Plan",
    filename: "plan.md",
    mime_type: "text/markdown",
    content_md: "",
    kind: "artifact",
    asset_id: "asset",
    source_revision_id: "revision",
    editable_source: true,
  } as Awaited<ReturnType<typeof fetchConversationDocument>>);
  render(<ChatDocumentArtifactPanel />);
  expect(await screen.findByText("Editable plan")).toBeTruthy();
  expect(fetchAssetText).toHaveBeenCalled();
});

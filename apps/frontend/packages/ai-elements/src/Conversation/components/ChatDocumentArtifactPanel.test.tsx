import { createStorageDownloadUrl, fetchAssetText, fetchConversationDocument, fetchConversationFile } from "@repo/api";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { ChatDocumentArtifactPanel } from "./ChatDocumentArtifactPanel";
import { ChatFileArtifactPanel } from "./ChatFileArtifactPanel";

const resourceUrl = "/api/storage-server/media/asset/revisions/revision/content?expires=2000000000&signature=signed";

const chatStoreMock = vi.hoisted(() => ({
  artifactPreview: {
    open: true,
    conversationId: "conversation" as string | null,
    documentId: "document" as string | null,
    fileId: null as string | null,
    token: 1,
  },
}));

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
    id: "file",
    conversation_id: "conversation",
    path: "page.HTML",
    asset_id: "asset",
    revision_id: "revision",
    filename: "page.HTML",
    title: "Saved page",
    mime_type: "text/html; charset=utf-8",
    content: "<h1>Saved page</h1>",
    size: 21,
    sha256: "sha",
    kind: "artifact",
    created_at: "2026-11-05T00:00:00Z",
    updated_at: "2026-11-05T00:00:00Z",
  })),
  fetchAssetText: vi.fn(async () => "<h1>Stored page</h1>"),
  fetchConversationDocumentSource: vi.fn(),
  updateConversationDocument: vi.fn(),
}));

vi.mock("../store/useChatStore", () => ({
  useChatStore: () => ({
    artifactPreview: chatStoreMock.artifactPreview,
    closeArtifactPreview: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.mocked(fetchAssetText).mockReset().mockResolvedValue("<h1>Stored page</h1>");
  Object.assign(chatStoreMock.artifactPreview, {
    open: true,
    conversationId: "conversation",
    documentId: "document",
    fileId: null,
    token: 1,
  });
});

it("loads metadata then previews HTML from srcDoc with the Asset URL as its base", async () => {
  render(<ChatDocumentArtifactPanel />);
  const frame = await screen.findByTitle("Generated page");
  expect(frame.tagName).toBe("IFRAME");
  expect(frame.hasAttribute("src")).toBe(false);
  expect(frame.getAttribute("srcdoc")).toContain(`<base href="${resourceUrl.replaceAll("&", "&amp;")}">`);
  expect(frame.getAttribute("srcdoc")).toContain("data-artifact-hidden-scrollbars");
  expect(frame.getAttribute("srcdoc")).toContain("Stored page");
  expect(fetchConversationDocument).toHaveBeenCalledWith(
    "conversation",
    "document",
    expect.objectContaining({ includeContent: false }),
  );
  expect(createStorageDownloadUrl).toHaveBeenCalled();
  expect(screen.queryByText("HTML 预览地址不可用，请重新打开预览。")).toBeNull();
});

it("renders Chat-owned HTML files with hidden scrollbars and preserved relative URL resolution", async () => {
  Object.assign(chatStoreMock.artifactPreview, { documentId: null, fileId: "file" });
  render(<ChatFileArtifactPanel />);
  const frame = await screen.findByTitle("Saved page");
  expect(frame.tagName).toBe("IFRAME");
  expect(frame.hasAttribute("src")).toBe(false);
  expect(frame.getAttribute("srcdoc")).toContain(`<base href="${resourceUrl.replaceAll("&", "&amp;")}">`);
  expect(frame.getAttribute("srcdoc")).toContain("data-artifact-hidden-scrollbars");
  expect(fetchConversationFile).toHaveBeenCalledWith(
    "conversation",
    "file",
    expect.objectContaining({ signal: expect.anything() }),
  );
});

it("loads an editable Markdown revision from Storage before opening the editor", async () => {
  vi.mocked(fetchAssetText).mockResolvedValueOnce("# Editable plan");
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

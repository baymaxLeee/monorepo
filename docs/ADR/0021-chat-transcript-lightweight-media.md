# ADR 0021: Chat transcript renders lightweight media references; bytes deferred to preview surfaces

## Status

Accepted. Complements ADR 0008 (artifact platform) and ADR 0014 (multimodal
provider configuration); refines the frontend rendering half of both.

## Context

The chat transcript rendered media products by fetching and decoding their
bytes inline, at mount, for every message:

- `ChatImageCard` called `useDocumentBlobUrl(..., enabled=true)` for **each**
  image in a generated group and rendered an `<img>`. A conversation with N
  generated images issued N `/documents/:id/source` requests plus N decodes on
  first render, and re-ran them on every conversation switch.
- `ChatVideoCard` eagerly fetched the blob and rendered a `<video>` as soon as
  the tool completed.
- `ChatMessageFilePart` was half-optimized: an `IntersectionObserver`
  (rootMargin 160px) deferred an image attachment's fetch until it scrolled
  near the viewport, but still fetched the full-resolution source and rendered
  an `<img>` thumbnail once visible.

This is a systemic performance problem: transcript render/re-render cost grows
O(media count), which is exactly the hot path on conversation switch and in
long conversations. The `write_file`/`edit_file` HTML/MD path did **not** have
this problem — `ChatArtifactCard` already renders a lightweight card (title +
`预览` button, zero content fetch) and defers the heavy render to
`ChatArtifactPanel` on click. So the correct, re-derivable pattern already
existed in the repo; the media cards were the outliers.

Grounding (per repo "industry practice" / AI-Native rules):

- The AI SDK `file` part is a reference (`{ mediaType, filename?, url }`); the
  protocol never dictates *when* the UI fetches the URL. Deferring the fetch to
  a click is fully protocol-compatible and invents no new part
  (`schemas/streaming/chat-uimessage-stream.md`).
- Vercel AI Elements ships `Attachment` with `inline` (badge), `grid`
  (thumbnail), and `list` variants — a byte-free badge/chip is a first-class,
  supported shape, not a private invention.
- Benchmark products keep the transcript light and move heavy content to a
  dedicated surface: Claude Artifacts and ChatGPT Canvas render substantial
  output in a side panel (Claude even renders a completed HTML artifact as a
  static screenshot in the transcript, not a live DOM); Cursor shows file pills
  that open the editor/diff.

## Decision

The chat transcript renders **lightweight references only**; media bytes are
fetched exclusively by the preview surfaces, on demand, after a click.

- Generated images (`ChatImageCard`) render one lightweight `ChatMediaCard`
  (icon + "共 N 张" + optional "M 张生成失败" note). Clicking opens the existing
  image lightbox (`openImagePreview` → `ChatImagePreview` → `useDocumentBlobUrls`),
  which fetches the whole group on open. No `<img>` is rendered in the transcript.
- Generated video (`ChatVideoCard`) renders the same `ChatMediaCard`. Clicking
  opens the side panel (`openArtifactPreview` → `ChatArtifactPanel`), whose
  `ArtifactPreview` already fetches + plays video/image/audio/pdf/html/md. No
  `<video>` is rendered in the transcript.
- File attachments (`ChatMessageFilePart`), including user-uploaded images,
  render as a pure `Attachment` chip (category icon + filename via
  `getMediaCategory`/`AttachmentInfo`), never an `<img>`, with no
  `IntersectionObserver` and no fetch at render. Clicking an image opens the
  lightbox; any other file opens the side panel.
- A new shared `apps/frontend/apps/chat/src/components/ChatMediaCard.tsx` is the
  single lightweight-card shell (one `<button>`, no nested interactive element,
  whole card is the click target) used by both image and video cards.
- `ChatArtifactPanel` exposes a download action in its header. Documents backed
  by object storage reuse the authenticated `/documents/:id/source` fetch;
  content-only text artifacts are downloaded from their current `content_md`
  (or the editor's current draft) as a browser-created Blob.

Only the two preview surfaces call the byte-fetching hooks: `ChatArtifactPanel`
uses `useDocumentBlobUrl` (single) and `ChatImagePreview` uses
`useDocumentBlobUrls` (group). No transcript component imports either hook.

## Rationale

The transcript and the preview surfaces answer different questions: the
transcript is "what products exist in this conversation" (cheap, scannable,
re-rendered constantly), while the preview is "show me this one product now"
(heavy, on demand, one at a time). Coupling byte fetch/decode to transcript
render conflated the two and made the common path pay for the rare one.
Converging every media type onto the artifact card's existing "reference →
preview" shape removes the outliers instead of adding a parallel mechanism, and
keeps the tool-output wire contract untouched.

## Consequences

- Render-time `/documents/:id/source` requests for a conversation drop from
  O(media count) to 0; byte requests happen only when a lightbox/panel opens.
- No backend, tool-output, or persistence change. `generate_image` still yields
  `{ images: [{ document_id, filename, media_type }] }`; older persisted
  messages render unchanged because only the card presentation changed.
- Download remains an explicit preview-surface action, so it adds no transcript
  render-time source requests and preserves the lightweight reference model.
- Deliberate UX trade-off (chosen over a lazy-thumbnail variant): the transcript
  shows no image thumbnail at all — more aggressive than Claude/ChatGPT, which
  keep a thumbnail/screenshot. Because there are no per-image tiles, the image
  card opens the lightbox at index 0 and the user pages through the group.
- If an at-a-glance thumbnail is later wanted without reintroducing the
  full-resolution cost, the follow-up is a dedicated backend thumbnail endpoint
  (small raster), not re-inlining the source bytes.
- `useDocumentBlobUrl` (single) remains, now used only by `ChatArtifactPanel`;
  the removed `IntersectionObserver`/eager-`<img>`/eager-`<video>` paths are
  deleted outright (no compatibility shim).

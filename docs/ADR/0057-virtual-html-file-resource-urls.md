# ADR 0057: Virtual HTML previews use signed resource URLs

## Status

Accepted

## Context

ADR-0055 moved generated HTML from Knowledge documents into Knowledge's
conversation-scoped virtual file tree. The new Chat file-detail endpoint
reconstructed every text file into one JSON `content` string. The frontend then
made a second authenticated source request, buffered the response as a `Blob`,
created an object URL, and assigned that object URL to the preview iframe.

This regressed the established resource-preview shape used by HTML documents,
video, audio, and PDF:

- large HTML crossed Knowledge → Chat → browser and was buffered before preview;
- the same HTML was also returned in the file-detail JSON response;
- iframe loading no longer used an addressable server resource;
- the browser could not load the authenticated Chat source endpoint directly
  because an iframe request cannot attach the API client's bearer header.

## Decision

1. Knowledge, as the virtual file owner, signs short-lived capability URLs for
   current `text/html` file entries. Minting is authenticated and scoped by the
   current user, organization, conversation, and path.
2. The signed URL identifies the file entry and its current SHA-256. Knowledge
   rejects expired signatures and signatures whose SHA no longer matches, so an
   edit invalidates previously minted URLs.
3. Knowledge serves the HTML directly from the current file entry with an inline
   HTML response and private cache lifetime bounded by the capability expiry.
4. Chat file detail keeps `content` for ordinary text previews, but returns
   `content: null` for HTML. It does not reconstruct the complete HTML merely to
   render file metadata.
5. The Chat frontend mints the capability after the HTML preview opens and
   assigns the returned URL directly to the iframe `src`. It does not fetch HTML
   bytes or create/revoke a Blob URL.
6. The obsolete authenticated Chat `/files/source` proxy and its frontend fetch
   wrapper are removed once the signed resource path is the only caller.

## Consequences

- Opening an HTML preview performs one lightweight file-detail request, one URL
  mint request, and one iframe navigation. The HTML body crosses only
  Knowledge → browser.
- Generated HTML follows the same short-lived resource URL convention as video,
  audio, PDF, and document-backed HTML.
- Signed URLs are derived preview state. They are not persisted in messages or
  file records and are invalidated by file edits.
- Markdown and other text previews retain their current content-based rendering
  and download behavior.

## References

- [ADR-0021: lightweight media references](0021-chat-transcript-lightweight-media.md)
- [ADR-0055: generic file tools](0055-unified-file-tools.md)

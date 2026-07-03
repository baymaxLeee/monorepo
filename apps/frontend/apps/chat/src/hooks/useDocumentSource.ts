import { fetchConversationDocumentSource } from "api";
import { useEffect, useState } from "react";

const MAX_CACHED_DOCUMENTS = 8;
const sourceCache = new Map<string, Promise<Blob>>();

function cacheKey(conversationId: string, documentId: string) {
  return `${conversationId}:${documentId}`;
}

export function fetchCachedDocumentSource(
  conversationId: string,
  documentId: string,
): Promise<Blob> {
  const key = cacheKey(conversationId, documentId);
  const cached = sourceCache.get(key);
  if (cached) {
    sourceCache.delete(key);
    sourceCache.set(key, cached);
    return cached;
  }

  const request = fetchConversationDocumentSource(
    conversationId,
    documentId,
  ).catch((error) => {
    sourceCache.delete(key);
    throw error;
  });
  sourceCache.set(key, request);
  while (sourceCache.size > MAX_CACHED_DOCUMENTS) {
    const oldest = sourceCache.keys().next().value;
    if (oldest) sourceCache.delete(oldest);
  }
  return request;
}

export function useDocumentBlobUrl(
  conversationId: string | undefined,
  documentId: string | null,
  enabled: boolean,
) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!enabled || !conversationId || !documentId) {
      setBlobUrl(null);
      setLoading(false);
      setError(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    void fetchCachedDocumentSource(conversationId, documentId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((nextError: unknown) => {
        if (active) setError(nextError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [conversationId, documentId, enabled]);

  return { blobUrl, loading, error };
}

// Resolve a group of documents to object URLs at once (e.g. every image in a
// lightbox so prev/next has each slide ready). Reuses the shared source cache,
// keeps results aligned with the input ids, and revokes URLs on cleanup. Keyed
// on the joined id list so a stable group does not re-fetch every render.
export function useDocumentBlobUrls(
  conversationId: string | undefined,
  documentIds: string[],
): Array<string | null> {
  const key = documentIds.join("|");
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    if (!conversationId || ids.length === 0) {
      setUrlMap({});
      return;
    }
    let active = true;
    const created: string[] = [];
    void Promise.all(
      ids.map(async (documentId) => {
        try {
          const blob = await fetchCachedDocumentSource(
            conversationId,
            documentId,
          );
          const url = URL.createObjectURL(blob);
          created.push(url);
          return [documentId, url] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (!active) {
        for (const url of created) URL.revokeObjectURL(url);
        return;
      }
      const next: Record<string, string> = {};
      for (const pair of pairs) if (pair) next[pair[0]] = pair[1];
      setUrlMap(next);
    });
    return () => {
      active = false;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [conversationId, key]);

  return documentIds.map((documentId) => urlMap[documentId] ?? null);
}

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

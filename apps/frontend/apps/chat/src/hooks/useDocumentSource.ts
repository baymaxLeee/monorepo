import { fetchConversationDocumentSource } from "api";
import { useEffect, useState } from "react";

const MAX_CACHED_DOCUMENTS = 8;
const sourceCache = new Map<string, Promise<Blob>>();

function docPrefix(conversationId: string, documentId: string) {
  return `${conversationId}:${documentId}:`;
}

function cacheKey(conversationId: string, documentId: string, version: string) {
  return `${docPrefix(conversationId, documentId)}${version}`;
}

export function fetchCachedDocumentSource(
  conversationId: string,
  documentId: string,
  version = "",
): Promise<Blob> {
  const key = cacheKey(conversationId, documentId, version);
  const cached = sourceCache.get(key);
  if (cached) {
    sourceCache.delete(key);
    sourceCache.set(key, cached);
    return cached;
  }

  // Artifacts are edited in place (same id, bumped updated_at), so a stale entry
  // for an earlier version would otherwise be served forever. Drop every prior
  // version of this document before fetching the new one.
  const prefix = docPrefix(conversationId, documentId);
  for (const existing of sourceCache.keys()) {
    if (existing.startsWith(prefix)) sourceCache.delete(existing);
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
  version = "",
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
    void fetchCachedDocumentSource(conversationId, documentId, version)
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
  }, [conversationId, documentId, enabled, version]);

  return { blobUrl, loading, error };
}

export function useDocumentBlobUrls(
  conversationId: string | undefined,
  documentIds: string[],
  versions?: Array<string | undefined>,
): Array<string | null> {
  const key = documentIds
    .map((id, index) => `${id}@${versions?.[index] ?? ""}`)
    .join("|");
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const entries = key ? key.split("|") : [];
    if (!conversationId || entries.length === 0) {
      setUrlMap({});
      return;
    }
    let active = true;
    const created: string[] = [];
    setUrlMap({});
    for (const entry of entries) {
      const separator = entry.lastIndexOf("@");
      const documentId = entry.slice(0, separator);
      const version = entry.slice(separator + 1);
      void (async () => {
        try {
          const blob = await fetchCachedDocumentSource(
            conversationId,
            documentId,
            version,
          );
          if (!active) return;
          const url = URL.createObjectURL(blob);
          created.push(url);
          setUrlMap((prev) => ({ ...prev, [documentId]: url }));
        } catch {}
      })();
    }
    return () => {
      active = false;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [conversationId, key]);

  return documentIds.map((documentId) => urlMap[documentId] ?? null);
}

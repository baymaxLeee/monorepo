import type { ConversationDocumentDetail } from "api";
import { fetchConversationDocumentSource } from "api";
import { useEffect, useState } from "react";

const MAX_CACHED_DOCUMENTS = 8;

export type DocumentSourceOptions = {
  version?: string;
  maxDim?: number;
};

const sourceCache = new Map<string, Promise<Blob>>();

function docPrefix(conversationId: string, documentId: string) {
  return `${conversationId}:${documentId}:`;
}

function normalizeSourceOptions(
  versionOrOptions?: string | DocumentSourceOptions,
): DocumentSourceOptions {
  if (typeof versionOrOptions === "string") {
    return { version: versionOrOptions };
  }
  return versionOrOptions ?? {};
}

function cacheKey(
  conversationId: string,
  documentId: string,
  version: string,
  maxDim?: number,
) {
  const variant = maxDim ? `thumb-${maxDim}` : "full";
  return `${docPrefix(conversationId, documentId)}${variant}:${version}`;
}

export function fetchCachedDocumentSource(
  conversationId: string,
  documentId: string,
  versionOrOptions?: string | DocumentSourceOptions,
): Promise<Blob> {
  const { version = "", maxDim } = normalizeSourceOptions(versionOrOptions);
  const key = cacheKey(conversationId, documentId, version, maxDim);
  const cached = sourceCache.get(key);
  if (cached) {
    sourceCache.delete(key);
    sourceCache.set(key, cached);
    return cached;
  }

  const variant = maxDim ? `thumb-${maxDim}` : "full";
  const variantPrefix = `${docPrefix(conversationId, documentId)}${variant}:`;
  for (const existing of sourceCache.keys()) {
    if (existing.startsWith(variantPrefix)) sourceCache.delete(existing);
  }

  const request = fetchConversationDocumentSource(conversationId, documentId, {
    maxDim,
  }).catch((error) => {
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

export async function downloadConversationDocument(
  conversationId: string,
  documentId: string,
  document: ConversationDocumentDetail,
  content: string = document.content_md,
) {
  const blob =
    document.source_object_bucket && document.source_object_key
      ? await fetchCachedDocumentSource(
          conversationId,
          documentId,
          document.updated_at,
        )
      : new Blob([content], {
          type: document.mime_type || "application/octet-stream",
        });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download =
    document.source_filename || document.filename || document.title;
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function useDocumentBlobUrl(
  conversationId: string | undefined,
  documentId: string | null,
  enabled: boolean,
  versionOrOptions?: string | DocumentSourceOptions,
) {
  const { version = "", maxDim } = normalizeSourceOptions(versionOrOptions);
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
    void fetchCachedDocumentSource(conversationId, documentId, {
      version,
      maxDim,
    })
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
  }, [conversationId, documentId, enabled, maxDim, version]);

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
            {
              version,
            },
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

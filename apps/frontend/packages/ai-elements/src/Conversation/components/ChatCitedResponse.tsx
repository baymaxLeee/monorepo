import { InlineCitation, MessageResponse, Sources, type SourceItem } from "@repo/ai-elements";
import { isPublicHttpUrl } from "@repo/shared";
import type { Citation } from "ai";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";

type CitationContextValue = {
  citations: Citation[];
  sources: SourceItem[];
  resolveSourceHref?: (source: SourceItem) => string | undefined;
  resolveSourceAction?: (source: SourceItem) => (() => Promise<void>) | undefined;
};

const CitationContext = createContext<CitationContextValue>({ citations: [], sources: [] });

function sourceId(source: SourceItem): string | undefined {
  const value = source as Record<string, unknown>;
  return typeof value.sourceId === "string" ? value.sourceId : typeof value.id === "string" ? value.id : undefined;
}

function citationSource(citation: Citation): SourceItem {
  const source = citation.source;
  return source.sourceType === "url"
    ? {
        type: "source-url",
        sourceId: source.id,
        url: source.url,
        title: source.title,
        providerMetadata: source.providerMetadata,
      }
    : {
        type: "source-document",
        sourceId: source.id,
        mediaType: source.mediaType,
        title: source.title,
        filename: source.filename,
        providerMetadata: source.providerMetadata,
      };
}

function resolvedCitationSource(citation: Citation, sources: SourceItem[]): SourceItem {
  return sources.find((source) => sourceId(source) === citation.source.id) ?? citationSource(citation);
}

function CitationLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { citations, sources, resolveSourceHref, resolveSourceAction } = useContext(CitationContext);
  // Match explicit links to native evidence without changing Streamdown's renderer
  // identity when text chunks or late source parts arrive.
  const index = citations.length
    ? -1
    : sources.findIndex((source) => {
        const value = source as Record<string, unknown>;
        return value.url === href && href && isPublicHttpUrl(href);
      });
  return index >= 0 ? (
    <InlineCitation
      source={sources[index]}
      resolvedHref={resolveSourceHref?.(sources[index])}
      onOpen={resolveSourceAction?.(sources[index])}
      index={index + 1}
    >
      {children}
    </InlineCitation>
  ) : (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function CitationMarker({
  node,
  ...props
}: ComponentProps<"sup"> & { node?: { properties?: Record<string, unknown> } }) {
  const { citations, sources, resolveSourceHref, resolveSourceAction } = useContext(CitationContext);
  const rawIndex = (props as Record<string, unknown>)["data-citation-index"] ?? node?.properties?.dataCitationIndex;
  const citationIndex = typeof rawIndex === "number" ? rawIndex : Number(rawIndex);
  const citation = Number.isInteger(citationIndex) ? citations[citationIndex] : undefined;
  if (!citation) return <sup {...props} />;
  const source = resolvedCitationSource(citation, sources);
  const listedSourceIndex = sources.findIndex((candidate) => sourceId(candidate) === citation.source.id);
  return (
    <InlineCitation
      source={source}
      resolvedHref={resolveSourceHref?.(source)}
      onOpen={resolveSourceAction?.(source)}
      index={listedSourceIndex >= 0 ? listedSourceIndex + 1 : citationIndex + 1}
      aria-label={`引用：${citation.source.title}`}
    />
  );
}

const citationComponents = { a: CitationLink, sup: CitationMarker };

export function ChatCitedResponse({
  text,
  streaming,
  sources,
  citations = [],
  resolveSourceHref,
  resolveSourceAction,
}: {
  text: string;
  streaming: boolean;
  sources: SourceItem[];
  citations?: Citation[];
  resolveSourceHref?: (source: SourceItem) => string | undefined;
  resolveSourceAction?: (source: SourceItem) => (() => Promise<void>) | undefined;
}) {
  const unpositionedCitations = citations.filter(
    (citation) =>
      citation.startIndex === undefined ||
      citation.endIndex === undefined ||
      citation.startIndex < 0 ||
      citation.endIndex <= citation.startIndex ||
      citation.endIndex > text.length,
  );
  return (
    <CitationContext value={{ citations, sources, resolveSourceHref, resolveSourceAction }}>
      <MessageResponse isAnimating={streaming} components={citationComponents} citations={citations}>
        {text}
      </MessageResponse>
      {unpositionedCitations.length ? (
        <span className="mt-1 flex flex-wrap gap-1" aria-label="此文本的引用">
          {unpositionedCitations.map((citation) => {
            const source = resolvedCitationSource(citation, sources);
            const citationIndex = citations.indexOf(citation);
            const listedSourceIndex = sources.findIndex((candidate) => sourceId(candidate) === citation.source.id);
            return (
              <InlineCitation
                key={`${citation.source.id}-${citationIndex}`}
                source={source}
                resolvedHref={resolveSourceHref?.(source)}
                onOpen={resolveSourceAction?.(source)}
                index={listedSourceIndex >= 0 ? listedSourceIndex + 1 : citationIndex + 1}
                aria-label={`引用：${citation.source.title}`}
              />
            );
          })}
        </span>
      ) : null}
    </CitationContext>
  );
}

export { Sources };

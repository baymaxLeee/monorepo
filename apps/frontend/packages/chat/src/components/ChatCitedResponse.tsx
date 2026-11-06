import { InlineCitation, MessageResponse, Sources, type SourceItem } from "@repo/ai-elements";
import { isPublicHttpUrl } from "@repo/shared";
import { createContext, useContext, type ReactNode } from "react";

const CitationSources = createContext<SourceItem[]>([]);

function CitationLink({ href, children }: { href?: string; children?: ReactNode }) {
  const sources = useContext(CitationSources);
  // Match explicit links to native evidence without changing Streamdown's renderer
  // identity when text chunks or late source parts arrive.
  const index = sources.findIndex((source) => source.url === href && href && isPublicHttpUrl(href));
  return index >= 0 ? (
    <InlineCitation source={sources[index]} index={index + 1}>
      {children}
    </InlineCitation>
  ) : (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

const citationComponents = { a: CitationLink };

export function ChatCitedResponse({
  text,
  streaming,
  sources,
}: {
  text: string;
  streaming: boolean;
  sources: SourceItem[];
}) {
  return (
    <CitationSources value={sources}>
      <MessageResponse isAnimating={streaming} components={citationComponents}>
        {text}
      </MessageResponse>
    </CitationSources>
  );
}

export { Sources };

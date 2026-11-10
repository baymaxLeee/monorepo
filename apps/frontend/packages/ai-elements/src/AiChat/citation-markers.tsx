import type { Citation } from "ai";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Block, parseMarkdownIntoBlocks, type BlockProps } from "streamdown";

type Marker = { index: number; end: number };
type CitationBlock = { content: string; start: number; markers: Marker[] };
const BlocksContext = createContext<CitationBlock[]>([]);

export function CitationBlocks({
  text,
  citations = [],
  children,
}: {
  text: string;
  citations?: Citation[];
  children: ReactNode;
}) {
  const blocks = useMemo(() => {
    let offset = 0;
    return parseMarkdownIntoBlocks(text).map((content) => {
      const start = offset;
      offset += content.length;
      return {
        content,
        start,
        markers: citations.flatMap((citation, index) => {
          const { startIndex, endIndex } = citation;
          return startIndex !== undefined &&
            endIndex !== undefined &&
            startIndex >= 0 &&
            endIndex > startIndex &&
            endIndex <= text.length &&
            endIndex > start &&
            endIndex <= offset
            ? [{ index, end: endIndex - start }]
            : [];
        }),
      };
    });
  }, [text, citations]);
  return <BlocksContext value={blocks}>{children}</BlocksContext>;
}

type Node = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: Node[];
};
const inlineContainers = new Set(["p", "li", "td", "th", "strong", "em", "del", "h1", "h2", "h3", "h4", "h5", "h6"]);
const markerNode = (index: number): Node => ({
  type: "element",
  tagName: "sup",
  properties: { dataCitationIndex: index },
  children: [],
});

function markersPlugin({ markers }: { markers: Marker[] }) {
  return (tree: Node) => {
    const placed = new Set<number>();
    const visit = (parent: Node) => {
      if (!parent.children || parent.tagName === "a" || parent.tagName === "code" || parent.tagName === "pre") return;
      for (const child of [...parent.children]) visit(child);
      if (!inlineContainers.has(parent.tagName ?? "")) return;
      for (let i = parent.children.length - 1; i >= 0; i--) {
        const child = parent.children[i];
        const start = child.position?.start?.offset;
        const end = child.position?.end?.offset;
        if (start === undefined || end === undefined) continue;
        const matching = markers.filter(
          (marker) => !placed.has(marker.index) && marker.end > start && marker.end <= end,
        );
        if (!matching.length) continue;
        matching.forEach((marker) => placed.add(marker.index));
        // Plain text can be split exactly. Escapes/Markdown syntax retain the
        // containing node and put the citation beside it, never inside its HTML.
        if (child.type === "text" && child.value?.length === end - start) {
          const replacement: Node[] = [];
          let from = 0;
          for (const marker of [...matching].sort((a, b) => a.end - b.end)) {
            const to = marker.end - start;
            replacement.push({ type: "text", value: child.value.slice(from, to) }, markerNode(marker.index));
            from = to;
          }
          replacement.push({ type: "text", value: child.value.slice(from) });
          parent.children.splice(i, 1, ...replacement);
        } else parent.children.splice(i + 1, 0, ...matching.map((marker) => markerNode(marker.index)));
      }
    };
    visit(tree);
    // Code, empty blocks and syntactically ambiguous ranges keep visible block
    // evidence; do not inject markup into code or silently discard a citation.
    const remaining = markers.filter((marker) => !placed.has(marker.index));
    if (remaining.length)
      tree.children?.push({
        type: "element",
        tagName: "p",
        children: remaining.map((marker) => markerNode(marker.index)),
      });
  };
}

/** Streamdown AST offsets are local to each block, while AI SDK offsets are local to the text part. */
export function CitedMarkdownBlock(props: BlockProps) {
  const blocks = useContext(BlocksContext);
  const block = blocks[props.index];
  // SDK snapshots may clone citations on every text delta. Stable placement
  // content, rather than object identity, keeps completed blocks memoized.
  const placement = JSON.stringify(block?.markers ?? []);
  const plugins = useMemo(() => {
    const markers = JSON.parse(placement) as Marker[];
    return markers.length
      ? ([...(props.rehypePlugins ?? []), [markersPlugin, { markers }]] as BlockProps["rehypePlugins"])
      : props.rehypePlugins;
  }, [placement, props.rehypePlugins]);
  return <Block {...props} rehypePlugins={plugins} />;
}

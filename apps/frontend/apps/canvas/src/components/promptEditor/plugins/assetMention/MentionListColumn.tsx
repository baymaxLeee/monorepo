import { Tooltip, TooltipContent, TooltipTrigger, Button } from "@repo/design-system";
import { ChevronDown } from "lucide-react";
import { Fragment, type Ref } from "react";

import { HIDDEN_SCROLLBAR_CLASS, HIDDEN_SCROLLBAR_STYLE } from "@/hooks/useHorizontalScrollFade";
import t from "@/utils/i18n";

import { AssetAvatar } from "./AssetAvatar";
import { ASSETS_ROOT_ID, mentionNodeToAsset, splitHighlight, unavailableAssetMessage } from "./mentionTree";
import { AssetReviewMark } from "./ReviewStatus";
import type { MentionNode } from "./types";

const nodeID = (node: MentionNode) => node.DraftID ?? node.ID;

function HighlightText({ text, query }: { text: string; query: string }) {
  let offset = 0;
  return (
    <>
      {splitHighlight(text, query).map((part) => {
        const start = offset;
        offset += part.text.length;
        return (
          <span className={part.match ? "text-primary" : undefined} key={`${start}-${offset}-${part.text}`}>
            {part.text}
          </span>
        );
      })}
    </>
  );
}

function ChevronIcon({ expanded, section = false }: { expanded: boolean; section?: boolean }) {
  return (
    <ChevronDown
      aria-hidden
      className="shrink-0 transition-transform"
      size={16}
      strokeWidth={1.5}
      style={{
        transform: section ? (expanded ? "rotate(180deg)" : undefined) : expanded ? undefined : "rotate(-90deg)",
      }}
    />
  );
}

export function MentionListColumn({
  sections,
  groupIds,
  activeId,
  query,
  loading,
  loadingMore,
  hasMore,
  empty,
  listRef,
  onHover,
  onSelect,
  onToggle,
  onToggleSection,
  expandedIds,
  expandedSectionIds,
  onLoadMore,
  maxHeight,
}: {
  sections: MentionNode[];
  groupIds: ReadonlySet<string>;
  activeId?: string;
  query: string;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  empty?: boolean;
  listRef?: Ref<HTMLDivElement>;
  onHover: (node: MentionNode, element: HTMLElement) => void;
  onSelect: (node: MentionNode) => void;
  onToggle: (node: MentionNode) => void;
  onToggleSection: (node: MentionNode) => void;
  expandedIds: ReadonlySet<string>;
  expandedSectionIds: ReadonlySet<string>;
  onLoadMore?: () => void;
  maxHeight?: number;
}) {
  const assetsExpanded = expandedSectionIds.has(ASSETS_ROOT_ID);
  const assetsVisible =
    assetsExpanded && sections.some((section) => section.ID === ASSETS_ROOT_ID && section.Children.length > 0);
  const renderNode = (node: MentionNode, nested = false) => {
    const id = nodeID(node);
    const group = groupIds.has(node.ID);
    const expanded = group && expandedIds.has(node.ID);
    const asset = mentionNodeToAsset(node);
    const unavailable = group ? undefined : unavailableAssetMessage(asset);
    const button = (
      <Button
        variant="ghost"
        aria-disabled={Boolean(unavailable)}
        aria-expanded={group ? expanded : undefined}
        className={`box-border flex h-[42px] w-full cursor-pointer items-center gap-2 border-0 text-left text-[13px] leading-5.5 outline-none ${
          nested ? "pl-10 pr-3" : "px-3"
        } ${
          id === activeId
            ? "rounded-[8px] bg-[rgba(26,27,30,0.05)] font-medium"
            : "rounded-[8px] bg-[transparent] font-normal"
        }`}
        data-mention-id={id}
        onClick={() => (group ? onToggle(node) : onSelect(node))}
        onMouseEnter={(event) => onHover(node, event.currentTarget)}
        type="button"
      >
        {group ? <ChevronIcon expanded={expanded} /> : null}
        <span
          className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-muted ${
            group ? "h-6 w-6" : "h-8 w-8"
          }`}
        >
          <AssetAvatar asset={asset} />
          {!group ? (
            <span className="absolute left-0 top-0 flex">
              <AssetReviewMark asset={asset} />
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">
          <HighlightText query={query} text={node.Label} />
          {group ? ` · ${node.Children.length}` : null}
        </span>
      </Button>
    );
    return unavailable ? (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex max-w-full" />}>{button}</TooltipTrigger>
        <TooltipContent>{unavailable}</TooltipContent>
      </Tooltip>
    ) : (
      button
    );
  };

  return (
    <div
      className={`overflow-y-auto ${HIDDEN_SCROLLBAR_CLASS}`}
      onScroll={
        onLoadMore && hasMore && assetsExpanded
          ? (event) => {
              const element = event.currentTarget;
              if (element.scrollHeight - element.scrollTop - element.clientHeight < element.clientHeight / 3) {
                onLoadMore();
              }
            }
          : undefined
      }
      ref={listRef}
      style={{ ...HIDDEN_SCROLLBAR_STYLE, msOverflowStyle: "none", maxHeight }}
    >
      {loading ? (
        <div className="flex h-[42px] items-center px-3 text-[12px] text-muted-foreground">{t("查询中...")}</div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-[6px]">
          {sections.map((section) => {
            const sectionExpanded = expandedSectionIds.has(section.ID);
            return (
              <Fragment key={section.ID}>
                <li className="shrink-0">
                  <Button
                    variant="ghost"
                    aria-expanded={sectionExpanded}
                    className="flex h-[42px] w-full cursor-pointer items-center justify-between rounded-[8px] border-0 bg-[transparent] px-3 text-left text-[13px] font-normal leading-5.5 text-foreground outline-none"
                    onClick={() => onToggleSection(section)}
                    type="button"
                  >
                    <span>{section.Label}</span>
                    <ChevronIcon expanded={sectionExpanded} section />
                  </Button>
                </li>
                {sectionExpanded
                  ? section.Children.map((node) => (
                      <Fragment key={nodeID(node)}>
                        <li className="shrink-0">{renderNode(node)}</li>
                        {groupIds.has(node.ID) && expandedIds.has(node.ID)
                          ? node.Children.map((child) => (
                              <li className="shrink-0" key={nodeID(child)}>
                                {renderNode(child, true)}
                              </li>
                            ))
                          : null}
                      </Fragment>
                    ))
                  : null}
              </Fragment>
            );
          })}
          {empty ? (
            <li className="flex h-[42px] items-center px-3 text-[12px] text-muted-foreground">{t("未找到匹配资产")}</li>
          ) : null}
        </ul>
      )}
      {assetsExpanded && loadingMore ? (
        <div className="flex h-7 items-center justify-center text-[12px] text-muted-foreground">{t("加载更多...")}</div>
      ) : assetsVisible && !loading && !empty && !hasMore ? (
        <div className="flex h-7 items-center justify-center text-[12px] text-muted-foreground">{t("已加载完毕")}</div>
      ) : null}
    </div>
  );
}

import { toast } from "@repo/design-system";
import Mention from "@tiptap/extension-mention";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ReactNodeViewRenderer, ReactRenderer } from "@tiptap/react";
import { type SuggestionKeyDownProps, type SuggestionProps, exitSuggestion } from "@tiptap/suggestion";

import { ASSET_LIBRARY_DIALOG_CLASS } from "./AddAssetToLibraryDialog";
import { createAssetMentionNode } from "./AssetMentionNode";
import {
  AssetSuggestionList,
  type AssetSuggestionListProps,
  type AssetSuggestionListRef,
  PREVIEW_POPUP_CLASS,
} from "./AssetSuggestionList";
import { applyAssetMentionSelection } from "./mentionSelection";
import {
  appendMentionTrees,
  collectMentionAssets,
  localMentionNodes,
  mergeLocalMentionNodes,
  overlayLocalBlobPreviews,
  unavailableAssetMessage,
} from "./mentionTree";
import { getSuggestionPosition } from "./suggestionPosition";
import type {
  AssetMentionItem,
  AssetMentionSource,
  AssetQueryDataSource,
  AssetQueryState,
  MentionTreeResult,
} from "./types";

const mentionQueryDebounce = 300;
const mentionQueryLimit = 20;

const overlayMentionTree = (source: AssetMentionSource, query: string, items: MentionTreeResult["items"]) => {
  const snapshot = source.getSnapshot();
  return overlayLocalBlobPreviews(mergeLocalMentionNodes(items, localMentionNodes(snapshot, query)), snapshot);
};

const queryMentionTreeFromLibrary = async (
  source: AssetMentionSource,
  query: string,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<MentionTreeResult> => {
  signal.throwIfAborted();
  if (!source.queryTree) {
    return {
      items: overlayMentionTree(source, query, []),
    };
  }
  const remote = await source.queryTree(query, cursor, mentionQueryLimit, signal);
  signal.throwIfAborted();
  return {
    ...remote,
    items:
      cursor === undefined
        ? overlayMentionTree(source, query, remote.items)
        : overlayLocalBlobPreviews(remote.items, source.getSnapshot()),
  };
};

const createInitialQueryState = (): AssetQueryState => ({
  loading: false,
  loadingMore: false,
  query: "",
  items: [],
});

const createAssetQueryDataSource = (source: AssetMentionSource): AssetQueryDataSource => {
  let state: AssetQueryState = createInitialQueryState();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestController: AbortController | undefined;
  let latestRequestId = 0;
  let stopStoreWatch: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((listener) => listener());

  const applyLibraryItems = async (
    queryValue: string,
    cursor: string | undefined,
    append: boolean,
    signal: AbortSignal,
    requestId: number,
  ) => {
    try {
      const result = await queryMentionTreeFromLibrary(source, queryValue, cursor, signal);
      if (signal.aborted || requestId !== latestRequestId) {
        return;
      }
      const items = append ? appendMentionTrees(state.items, result.items) : result.items;
      state = {
        ...state,
        nextCursor: result.nextCursor,
        loading: false,
        loadingMore: false,
        query: queryValue,
        items,
      };
      requestController = undefined;
      notify();
    } catch {
      if (signal.aborted || requestId !== latestRequestId) {
        return;
      }
      state = { ...state, loading: false, loadingMore: false };
      requestController = undefined;
      notify();
    }
  };

  const startQuery = (queryValue: string, debounce: boolean) => {
    watchStore();
    latestRequestId += 1;
    const requestId = latestRequestId;
    clearTimeout(debounceTimer);
    requestController?.abort();
    requestController = new AbortController();
    const { signal } = requestController;
    state = {
      ...state,
      nextCursor: undefined,
      loading: true,
      loadingMore: false,
      query: queryValue,
    };
    notify();
    const run = () => {
      debounceTimer = undefined;
      void applyLibraryItems(queryValue, undefined, false, signal, requestId);
    };
    if (debounce) {
      debounceTimer = setTimeout(run, mentionQueryDebounce);
      return;
    }
    run();
  };

  const watchStore = () => {
    if (stopStoreWatch) {
      return;
    }
    stopStoreWatch = source.subscribe(() => {
      state = {
        ...state,
        items: overlayMentionTree(source, state.query, state.items),
      };
      notify();
    });
  };

  const abortInFlight = () => {
    latestRequestId += 1;
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    requestController?.abort();
    requestController = undefined;
    stopStoreWatch?.();
    stopStoreWatch = undefined;
  };

  const cancel = () => {
    abortInFlight();
    if (state.loading || state.loadingMore) {
      state = { ...state, loading: false, loadingMore: false };
      notify();
    }
  };

  return {
    cancel,
    getState: () => state,
    loadMore: () => {
      if (state.loading || state.loadingMore || !state.nextCursor) {
        return;
      }
      latestRequestId += 1;
      const requestId = latestRequestId;
      requestController?.abort();
      requestController = new AbortController();
      state = { ...state, loadingMore: true };
      notify();
      void applyLibraryItems(state.query, state.nextCursor, true, requestController.signal, requestId);
    },
    query: (queryValue) => startQuery(queryValue, true),
    refresh: () => {
      if (state.loading || state.loadingMore) {
        return;
      }
      latestRequestId += 1;
      const requestId = latestRequestId;
      requestController?.abort();
      requestController = new AbortController();
      void applyLibraryItems(state.query, undefined, false, requestController.signal, requestId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

const positionSuggestion = (element: HTMLElement, clientRect?: (() => DOMRect | null) | null) => {
  const anchorRect = clientRect?.();
  if (!anchorRect) {
    return;
  }

  const popupWidth = element.getBoundingClientRect().width || 300;
  const viewportPadding = 12;
  const popupHeight = Math.min(element.getBoundingClientRect().height || 404, window.innerHeight - viewportPadding * 2);
  const { left, top } = getSuggestionPosition({
    anchorRect,
    popupHeight,
    popupWidth,
    viewportHeight: window.innerHeight,
    viewportPadding,
    viewportWidth: window.innerWidth,
  });

  Object.assign(element.style, {
    position: "fixed",
    left: `${left}px`,
    top: `${top}px`,
    zIndex: "1000",
  });
};

const escapeAttribute = (value: string) =>
  value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

const applyMentionIdReplacements = (editorView: EditorView, mentionName: string, replacements: Map<string, string>) => {
  if (!replacements.size) {
    return;
  }
  const { state } = editorView;
  let tr = state.tr;
  let changed = false;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== mentionName) {
      return;
    }
    const currentId = String(node.attrs.id ?? "");
    const nextId = replacements.get(currentId);
    if (!nextId || nextId === currentId) {
      return;
    }
    tr = tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      id: nextId,
    });
    changed = true;
  });
  if (changed) {
    editorView.dispatch(tr.setMeta("addToHistory", false));
  }
};

const createMentionIdSyncPlugin = (source: AssetMentionSource, mentionName: string) =>
  new Plugin({
    view: (editorView) => {
      const stop = source.subscribeMentionIdResolved((items) =>
        applyMentionIdReplacements(editorView, mentionName, new Map(items.map((item) => [item.draftId, item.assetId]))),
      );
      return { destroy: stop };
    },
  });

export const createAssetMentionExtension = (source: AssetMentionSource) => {
  const dataSource = createAssetQueryDataSource(source);
  const AssetMentionNode = createAssetMentionNode(source);

  return Mention.extend({
    addNodeView() {
      return ReactNodeViewRenderer(AssetMentionNode);
    },
    addProseMirrorPlugins() {
      return [...(this.parent?.() ?? []), createMentionIdSyncPlugin(source, this.name)];
    },
    /**
     * 编辑器以 markdown 收发内容，默认序列化会把 mention 降级成 `@标题` 纯文本，
     * 资产 id 随之丢失，资产条的已引用标记和重新打开时的 chip 都会失效。
     * 这里保留 mention 的内联 HTML 形式，编辑器的 parseHtml 会在回读时还原成节点。
     */
    renderMarkdown(node) {
      const id = escapeAttribute(String(node.attrs?.id ?? ""));
      const label = escapeAttribute(String(node.attrs?.label ?? ""));
      return `<span data-type="mention" data-id="${id}" data-label="${label}"></span>`;
    },
  }).configure({
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    suggestion: {
      allowSpaces: true,
      // 默认只允许空格/行首后触发；插入资产时又会自动补空格，导致「资产@@」能唤起、
      // 「文字@」却不行。关掉前缀限制，紧挨任意字符也可唤起引用面板。
      allowedPrefixes: null,
      char: "@",
      items: ({ query }) => {
        dataSource.query(query);
        return collectMentionAssets(dataSource.getState().items);
      },
      command: ({ editor, range, props: asset }) => {
        const selectedAsset = asset as unknown as AssetMentionItem;
        const unavailable = unavailableAssetMessage(selectedAsset);
        if (unavailable) {
          toast.add({
            type: "warning",
            title: unavailable,
          });
          return;
        }
        const applySelection = (resolved: AssetMentionItem) =>
          applyAssetMentionSelection(editor, range, resolved, source);
        if (!source.select) {
          applySelection(selectedAsset);
          return;
        }
        void source
          .select(selectedAsset)
          .then(applySelection)
          .catch(() => undefined);
      },
      render: () => {
        let component: ReactRenderer<AssetSuggestionListRef, AssetSuggestionListProps> | null = null;
        let currentProps: SuggestionProps<AssetMentionItem, AssetMentionItem> | null = null;
        let resizeObserver: ResizeObserver | undefined;

        const updatePosition = () => {
          if (component && currentProps) {
            positionSuggestion(component.element, currentProps.clientRect);
          }
        };

        const onViewportChange = () => updatePosition();
        const onDocumentPointerDown = (event: PointerEvent) => {
          const target = event.target as Node;
          if (component?.element.contains(target) || currentProps?.editor.view.dom.contains(target)) {
            return;
          }

          if (target instanceof Element && target.closest(`.${PREVIEW_POPUP_CLASS}, .${ASSET_LIBRARY_DIALOG_CLASS}`)) {
            return;
          }

          if (currentProps) {
            exitSuggestion(currentProps.editor.view);
          }
        };

        return {
          onStart: (props) => {
            currentProps = props;
            component = new ReactRenderer(AssetSuggestionList, {
              editor: props.editor,
              props: {
                ...props,
                dataSource,
                onClose: () => exitSuggestion(props.editor.view),
                onReview: source.review,
                onAddToLibrary: source.addToLibrary,
              },
            });
            document.body.appendChild(component.element);
            updatePosition();
            resizeObserver = new ResizeObserver(updatePosition);
            resizeObserver.observe(component.element);
            document.addEventListener("pointerdown", onDocumentPointerDown, true);
            window.addEventListener("resize", onViewportChange);
            window.addEventListener("scroll", onViewportChange, true);
          },
          onUpdate: (props) => {
            currentProps = props;
            component?.updateProps({
              ...props,
              dataSource,
              onClose: () => exitSuggestion(props.editor.view),
              onReview: source.review,
              onAddToLibrary: source.addToLibrary,
            });
            updatePosition();
          },
          onKeyDown: ({ event }: SuggestionKeyDownProps) => component?.ref?.onKeyDown(event) ?? false,
          onExit: () => {
            resizeObserver?.disconnect();
            resizeObserver = undefined;
            document.removeEventListener("pointerdown", onDocumentPointerDown, true);
            window.removeEventListener("resize", onViewportChange);
            window.removeEventListener("scroll", onViewportChange, true);
            dataSource.cancel();
            component?.element.remove();
            component?.destroy();
            component = null;
            currentProps = null;
          },
        };
      },
    },
  });
};

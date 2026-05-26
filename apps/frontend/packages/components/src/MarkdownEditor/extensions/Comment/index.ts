import { Mark, mergeAttributes } from "@tiptap/core";
import type {
  Mark as ProseMirrorMark,
  Node as ProseMirrorNode,
} from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { slotClassNameFactory } from "../../../compat/className";

export interface CommentOptions {
  HTMLAttributes: Record<string, unknown>;
}

type CommentEventMap = {
  activeCommentChange: [commentId: string | null];
  commentAdded: [info: { commentId: string; content: string }];
  commentRemoved: [commentId: string];
};

type CommentEventListener<K extends keyof CommentEventMap> = (
  ...args: CommentEventMap[K]
) => void;

export interface CommentStorage {
  on: <K extends keyof CommentEventMap>(
    event: K,
    callback: CommentEventListener<K>,
  ) => void;
  off: <K extends keyof CommentEventMap>(
    event: K,
    callback: CommentEventListener<K>,
  ) => void;
  emit: <K extends keyof CommentEventMap>(
    event: K,
    ...args: CommentEventMap[K]
  ) => void;
}

interface CommentPluginState {
  activeCommentId: string | null;
  decorations: DecorationSet;
}

const cssPrefix = slotClassNameFactory("markdown-editor-comment");

export const COMMENT_MARK_CLASS_NAME = cssPrefix``;
export const COMMENT_ACTIVE_CLASS_NAME = cssPrefix`active`;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      /**
       * Add a comment to the current selection
       * (Triggered from editor internal selection)
       */
      addComment: (commentId: string) => ReturnType;

      /**
       * Remove comment by ID
       * (Triggered from external business component)
       */
      removeComment: (commentId: string) => ReturnType;

      /**
       * Focus and scroll to a specific comment
       * (Triggered from external business component to locate comment)
       */
      selectComment: (commentId: string) => ReturnType;
    };
  }

  interface Storage {
    comment: CommentStorage;
  }
}

/**
 * 根据 activeCommentId 生成装饰器
 * 使用更安全的方式创建装饰器，避免边界问题和重叠
 */
export function createDecorations(
  doc: ProseMirrorNode,
  activeCommentId: string | null,
  markName: string,
): DecorationSet {
  // 如果没有激活的评论 ID 或文档无效，返回空集合
  if (!activeCommentId || !doc || !doc.content) {
    return DecorationSet.empty;
  }

  const docSize = doc.content.size;

  // 文档为空时返回空集合
  if (docSize <= 0) {
    return DecorationSet.empty;
  }

  // 收集所有匹配的文本范围
  const ranges: Array<{ from: number; to: number }> = [];

  try {
    // 遍历文档查找匹配的评论标记
    doc.nodesBetween(0, docSize, (node: ProseMirrorNode, pos: number) => {
      // 只处理文本节点
      if (!node.isText || !node.marks || node.marks.length === 0) {
        return true; // 继续遍历子节点
      }

      // 查找匹配的评论标记
      const mark = node.marks.find(
        (m: ProseMirrorMark) =>
          m &&
          m.type &&
          m.type.name === markName &&
          m.attrs &&
          m.attrs.commentId === activeCommentId,
      );

      if (mark) {
        // 计算装饰器的位置范围
        const from = pos;
        const to = pos + node.nodeSize;

        // 确保位置有效
        if (from >= 0 && to > from && to <= docSize) {
          ranges.push({ from, to });
        }
      }

      return true; // 继续遍历
    });
  } catch (error) {
    console.warn("Error finding comment ranges:", error);
    return DecorationSet.empty;
  }

  // 如果没有匹配的范围，返回空集合
  if (ranges.length === 0) {
    return DecorationSet.empty;
  }

  // 合并相邻或重叠的范围
  const mergedRanges: Array<{ from: number; to: number }> = [];
  // 按起始位置排序
  ranges.sort((a, b) => a.from - b.from);

  for (const range of ranges) {
    if (mergedRanges.length === 0) {
      mergedRanges.push({ ...range });
    } else {
      const last = mergedRanges[mergedRanges.length - 1];
      // 如果当前范围与最后一个范围相邻或重叠，合并它们
      if (range.from <= last.to) {
        last.to = Math.max(last.to, range.to);
      } else {
        mergedRanges.push({ ...range });
      }
    }
  }

  // 创建装饰器数组
  const decorations: Decoration[] = [];

  for (const { from, to } of mergedRanges) {
    // 确保范围有效
    if (from >= 0 && to > from && to <= docSize) {
      try {
        // 为每个文本节点创建装饰器（参考 TemporarySelectionHighlight 的实现）
        doc.nodesBetween(from, to, (node: ProseMirrorNode, pos: number) => {
          if (node.isText) {
            const start = Math.max(pos, from);
            const end = Math.min(pos + node.nodeSize, to);
            if (start < end) {
              try {
                const decoration = Decoration.inline(start, end, {
                  class: COMMENT_ACTIVE_CLASS_NAME,
                });
                // 验证装饰器是否创建成功
                if (decoration) {
                  decorations.push(decoration);
                }
              } catch (error) {
                console.warn(
                  "Failed to create decoration at",
                  start,
                  end,
                  error,
                );
              }
            }
          }
          return true;
        });
      } catch (error) {
        console.warn("Error creating decoration for range", from, to, error);
      }
    }
  }

  // 如果没有装饰器，返回空集合
  if (decorations.length === 0) {
    return DecorationSet.empty;
  }

  try {
    // 创建装饰器集合
    const decorationSet = DecorationSet.create(doc, decorations);

    // 验证装饰器集合是否有效
    if (!decorationSet || decorationSet === DecorationSet.empty) {
      return DecorationSet.empty;
    }

    return decorationSet;
  } catch (error) {
    console.warn("Error creating DecorationSet:", error);
    return DecorationSet.empty;
  }
}

export const createCommentExtension = () => {
  // 插件 Key，用于在事务元数据中标识评论状态更新
  const commentDecorationKey = new PluginKey<CommentPluginState>(
    "comment-decoration",
  );

  return Mark.create<CommentOptions, CommentStorage>({
    name: "comment",

    addOptions() {
      return {
        HTMLAttributes: {
          class: COMMENT_MARK_CLASS_NAME,
        },
      };
    },

    addStorage() {
      // 事件总线实现
      const eventBus = new Map<
        keyof CommentEventMap,
        Set<(...args: any[]) => void>
      >();

      return {
        on: <K extends keyof CommentEventMap>(
          event: K,
          callback: CommentEventListener<K>,
        ) => {
          if (!eventBus.has(event)) {
            eventBus.set(event, new Set());
          }
          eventBus.get(event)!.add(callback as (...args: any[]) => void);
        },
        off: <K extends keyof CommentEventMap>(
          event: K,
          callback: CommentEventListener<K>,
        ) => {
          const callbacks = eventBus.get(event);
          if (callbacks) {
            callbacks.delete(callback as (...args: any[]) => void);
            if (callbacks.size === 0) {
              eventBus.delete(event);
            }
          }
        },
        emit: <K extends keyof CommentEventMap>(
          event: K,
          ...args: CommentEventMap[K]
        ) => {
          const callbacks = eventBus.get(event) as
            | Set<CommentEventListener<K>>
            | undefined;
          if (callbacks) {
            // 使用 Array.from 创建副本，避免在迭代时修改集合
            Array.from(callbacks).forEach((callback) => {
              try {
                callback(...args);
              } catch (error) {
                console.error(
                  `CommentExtension 事件 "${event}" 监听器错误:`,
                  error,
                );
              }
            });
          }
        },
      };
    },

    addAttributes() {
      return {
        commentId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-comment-id"),
          renderHTML: (attributes) => {
            if (!attributes.commentId) {
              return {};
            }
            return {
              "data-comment-id": attributes.commentId,
            };
          },
        },
      };
    },

    parseHTML() {
      return [
        {
          tag: "span[data-comment-id]",
        },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "span",
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
        0,
      ];
    },

    addCommands() {
      return {
        addComment:
          (commentId: string) =>
          ({ commands, state, tr, dispatch }) => {
            if (!commentId) {
              return false;
            }

            const { selection } = state;
            if (selection.empty) {
              return false;
            }

            const content = state.doc.textBetween(selection.from, selection.to);
            const selectionEnd = selection.to;

            // 设置评论标记
            const result = commands.setMark(this.name, { commentId });

            if (result && dispatch) {
              // 更新激活的评论 ID
              tr.setMeta(commentDecorationKey, { activeCommentId: commentId });
              tr.setSelection(TextSelection.create(tr.doc, selectionEnd));

              // 触发事件
              this.storage.emit("commentAdded", { commentId, content });
            }

            return result;
          },
        removeComment:
          (commentId: string) =>
          ({ tr, state, dispatch }) => {
            if (!commentId) {
              return false;
            }

            // 查找所有匹配该 commentId 的标记范围
            const ranges: { from: number; to: number }[] = [];

            state.doc.descendants((node: ProseMirrorNode, pos: number) => {
              const mark = node.marks.find(
                (m: ProseMirrorMark) =>
                  m.type.name === this.name && m.attrs.commentId === commentId,
              );
              if (mark) {
                ranges.push({ from: pos, to: pos + node.nodeSize });
              }
            });

            if (ranges.length === 0) {
              return false;
            }

            if (dispatch) {
              const pluginState = commentDecorationKey.getState(state);

              // 移除所有匹配的标记
              ranges.forEach(({ from, to }) => {
                tr.removeMark(from, to, this.type);
              });

              // 仅在删除当前激活评论时才重置激活态
              if (pluginState?.activeCommentId === commentId) {
                tr.setMeta(commentDecorationKey, { activeCommentId: null });
              }

              this.storage.emit("commentRemoved", commentId);
            }

            return true;
          },
        selectComment:
          (commentId: string) =>
          ({ tr, state, dispatch, view }) => {
            if (!commentId) {
              return false;
            }

            // 查找评论的范围
            let foundFrom = -1;
            let foundTo = -1;

            state.doc.descendants((node: ProseMirrorNode, pos: number) => {
              const mark = node.marks.find(
                (m: ProseMirrorMark) =>
                  m.type.name === this.name && m.attrs.commentId === commentId,
              );
              if (mark) {
                if (foundFrom === -1) {
                  foundFrom = pos;
                }
                foundTo = pos + node.nodeSize;
              }
            });

            if (foundFrom === -1 || foundTo === -1) {
              return false;
            }

            if (dispatch) {
              // 滚动到评论位置
              if (view) {
                try {
                  const dom = view.nodeDOM(foundFrom);
                  if (dom instanceof HTMLElement) {
                    dom.scrollIntoView({ behavior: "smooth", block: "center" });
                  }
                } catch (error) {
                  console.warn("Error scrolling to comment:", error);
                }
              }

              // 更新激活的评论 ID
              tr.setMeta(commentDecorationKey, { activeCommentId: commentId });
            }

            return true;
          },
      };
    },

    addProseMirrorPlugins() {
      const extension = this;

      return [
        new Plugin<CommentPluginState>({
          key: commentDecorationKey,
          state: {
            init(_, { doc }) {
              return {
                activeCommentId: null,
                decorations: createDecorations(doc, null, extension.name),
              };
            },
            apply(tr, oldPluginState, _oldState, newState) {
              // 检查事务元数据中是否有 activeCommentId 更新
              const meta = tr.getMeta(commentDecorationKey) as
                | { activeCommentId: string | null }
                | undefined;

              const nextActiveCommentId =
                meta && "activeCommentId" in meta
                  ? meta.activeCommentId
                  : oldPluginState.activeCommentId;

              if (
                !tr.docChanged &&
                nextActiveCommentId === oldPluginState.activeCommentId
              ) {
                return oldPluginState;
              }

              return {
                activeCommentId: nextActiveCommentId,
                decorations: createDecorations(
                  newState.doc,
                  nextActiveCommentId,
                  extension.name,
                ),
              };
            },
          },
          view() {
            return {
              update(nextView, prevState) {
                const prevPluginState =
                  commentDecorationKey.getState(prevState);
                const nextPluginState = commentDecorationKey.getState(
                  nextView.state,
                );
                const prevActiveCommentId =
                  prevPluginState?.activeCommentId ?? null;
                const nextActiveCommentId =
                  nextPluginState?.activeCommentId ?? null;

                if (prevActiveCommentId !== nextActiveCommentId) {
                  extension.storage.emit(
                    "activeCommentChange",
                    nextActiveCommentId,
                  );
                }
              },
            };
          },
          props: {
            decorations(state) {
              // 获取插件状态
              const pluginState = commentDecorationKey.getState(state);

              // 确保返回有效的 DecorationSet
              if (
                !pluginState ||
                pluginState.decorations === DecorationSet.empty
              ) {
                return DecorationSet.empty;
              }

              return pluginState.decorations;
            },
            handleClick(view, pos) {
              const { doc } = view.state;
              const $pos = doc.resolve(pos);

              // 查找当前位置的评论标记
              const marks = $pos.marks();
              const commentMark = marks.find(
                (mark) => mark.type.name === extension.name,
              );

              const nextCommentId = commentMark?.attrs.commentId || null;
              const pluginState = commentDecorationKey.getState(view.state);

              // 如果评论状态发生变化，更新状态
              if ((pluginState?.activeCommentId ?? null) !== nextCommentId) {
                const tr = view.state.tr.setMeta(commentDecorationKey, {
                  activeCommentId: nextCommentId,
                });
                view.dispatch(tr);
              }

              return false;
            },
          },
        }),
      ];
    },
  });
};

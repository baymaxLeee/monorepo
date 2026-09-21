import { forwardRef, useMemo, useRef } from "react";

import {
  type AssetMentionItem,
  type AssetMentionSource,
  type MarkdownEditorRef,
  PromptEditor,
  createAssetMentionExtension,
} from "@/components/promptEditor/index";
import t from "@/utils/i18n";

import { useStudioAssetStore } from "../store/assets";

export const ScriptEditor = forwardRef<
  MarkdownEditorRef,
  {
    editable: boolean;
    /** 生成中脚本区整体只读，光标落到 not-allowed 与设计稿一致。 */
    locked?: boolean;
    /** 默认展示分镜提示；复用方可以传 null 使用自己的占位内容。 */
    placeholder?: string | null;
    script: string;
    onChange: (value: string) => void;
    queryTree: NonNullable<AssetMentionSource["queryTree"]>;
    selectAsset: (asset: AssetMentionItem) => Promise<AssetMentionItem>;
    reviewAsset?: AssetMentionSource["review"];
    addAssetToLibrary?: AssetMentionSource["addToLibrary"];
  }
>(function ScriptEditor(
  {
    editable,
    locked = false,
    placeholder = t("输入分镜脚本提示词"),
    script,
    onChange,
    queryTree,
    selectAsset,
    reviewAsset,
    addAssetToLibrary,
  },
  ref,
) {
  const assetStore = useStudioAssetStore();
  const mentionCallbacksRef = useRef({
    addAssetToLibrary,
    queryTree,
    reviewAsset,
    selectAsset,
  });
  mentionCallbacksRef.current = {
    addAssetToLibrary,
    queryTree,
    reviewAsset,
    selectAsset,
  };
  const canReviewAsset = Boolean(reviewAsset);
  const canAddAssetToLibrary = Boolean(addAssetToLibrary);
  const extensions = useMemo(
    () => [
      createAssetMentionExtension({
        getSnapshot: assetStore.getSnapshot,
        queryTree: (...args) => mentionCallbacksRef.current.queryTree(...args),
        review: canReviewAsset ? (...args) => mentionCallbacksRef.current.reviewAsset?.(...args) : undefined,
        addToLibrary: canAddAssetToLibrary
          ? async (...args) => {
              await mentionCallbacksRef.current.addAssetToLibrary?.(...args);
            }
          : undefined,
        select: (...args) => mentionCallbacksRef.current.selectAsset(...args),
        subscribe: assetStore.subscribe,
        subscribeMentionIdResolved: assetStore.subscribeMentionIdResolved,
      }),
    ],
    [assetStore, canAddAssetToLibrary, canReviewAsset],
  );
  return (
    <PromptEditor
      editable={editable}
      extensions={extensions}
      locked={locked}
      onChange={onChange}
      placeholder={placeholder}
      ref={ref}
      value={script}
    />
  );
});

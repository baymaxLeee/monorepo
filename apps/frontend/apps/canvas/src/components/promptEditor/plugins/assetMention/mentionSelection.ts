import type { Editor, Range } from "@tiptap/core";

import type { AssetMentionItem, AssetMentionSource } from "./types";

export function applyAssetMentionSelection(
  editor: Editor,
  range: Range,
  asset: AssetMentionItem,
  source: Pick<AssetMentionSource, "shouldInsertMention">,
) {
  const chain = editor.chain().focus();
  if (source.shouldInsertMention?.(asset) === false) {
    chain.deleteRange(range).run();
    return;
  }
  chain
    .insertContentAt(range, [
      {
        attrs: {
          id: asset.id,
          label: asset.title,
        },
        type: "mention",
      },
      { text: " ", type: "text" },
    ])
    .run();
}

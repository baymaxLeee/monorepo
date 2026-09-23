import { Markdown } from "@/components/common";

import type { StoryboardAsset } from "../domain/types";

const ASSET_MENTION = /<span\b(?=[^>]*\bdata-type=(['"])mention\1)[^>]*>\s*<\/span>/gi;

function mentionAttribute(mention: string, name: "id" | "label") {
  return mention.match(new RegExp(`\\bdata-${name}=(['"])(.*?)\\1`, "i"))?.[2];
}

/** 将编辑器保存的资产 mention 转成 Markdown 中可读的资产名称。 */
function toPreviewMarkdown(script: string, references: readonly StoryboardAsset[]) {
  return script.replace(ASSET_MENTION, (mention) => {
    const id = mentionAttribute(mention, "id");
    const reference = references.find((item) => item.id === id || item.draftId === id);
    const label = mentionAttribute(mention, "label") || reference?.title || id;
    return label ? `@${label}` : "";
  });
}

export function DraftScriptPreview({ references, script }: { references: readonly StoryboardAsset[]; script: string }) {
  return (
    <div className="w-full">
      <Markdown data={toPreviewMarkdown(script, references)} />
    </div>
  );
}

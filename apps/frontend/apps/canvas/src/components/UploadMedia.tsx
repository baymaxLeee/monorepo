import { canvasUploadNode } from "@repo/api";
import { Button } from "@repo/design-system";
import { useAtomValue, useStore } from "jotai";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { applyGraphAtom, canvasGraphAtom } from "../store/graph";
import { canvasBusyAtom, useStudioMutationCoordinator } from "../store/mutations";

export function UploadMedia() {
  const input = useRef<HTMLInputElement>(null);
  const graph = useAtomValue(canvasGraphAtom);
  const busy = useAtomValue(canvasBusyAtom);
  const store = useStore();
  const coordinator = useStudioMutationCoordinator();
  const [progress, setProgress] = useState<number | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*,audio/*"
        className="hidden"
        aria-label="上传画布素材"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || !graph) return;
          setProgress(0);
          void coordinator
            .enqueue(async () => {
              const result = await canvasUploadNode(
                graph.canvas.id,
                crypto.randomUUID(),
                file,
                { name: Array.from(file.name).slice(0, 50).join("") },
                {
                  onUploadProgress: (event) => {
                    if (event.total) setProgress(Math.round((event.loaded * 100) / event.total));
                  },
                },
              );
              store.set(applyGraphAtom, result);
            })
            .catch(() => {})
            .finally(() => setProgress(null));
        }}
      />
      <Button
        variant="outline"
        className="w-full"
        disabled={busy || !graph || progress !== null}
        onClick={() => input.current?.click()}
      >
        <Upload className="size-4" />
        {progress === null ? "上传图片 / 视频 / 音频" : `上传中 ${progress}%`}
      </Button>
    </>
  );
}

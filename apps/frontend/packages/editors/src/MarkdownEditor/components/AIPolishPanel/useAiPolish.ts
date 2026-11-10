import { toast } from "@repo/design-system";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useEditorContext } from "../../context";
import { RewriteActionType } from "../../interface";
import {
  applyBlocksToSelection,
  extractSelectionToBlocks,
  extractTextFromPartialJson,
  insertBlocksAfterSelection,
  isSelectionSnapshotCurrent,
  parseSSEStream,
  type SelectionSnapshot,
} from "../../utils";
import { parseAiPolishResult } from "./protocol";

export type AiPolishStatus = "idle" | "loading" | "ready" | "error" | "cancelled";

interface PolishRequest {
  action: RewriteActionType;
  command: string;
}

export const useAiPolish = (editor: Editor, onClose: () => void) => {
  const { onAiPolish, setMaskVisible } = useEditorContext();
  const [status, setStatus] = useState<AiPolishStatus>("idle");
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [hasGeneratedText, setHasGeneratedText] = useState(false);
  const snapshotRef = useRef<SelectionSnapshot | undefined>(undefined);
  const resultTextsRef = useRef<string[]>([]);
  const lastRequestRef = useRef<PolishRequest | undefined>(undefined);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const requestVersionRef = useRef(0);

  const abortActiveRequest = useCallback(() => {
    requestVersionRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = undefined;
  }, []);

  useEffect(() => {
    setMaskVisible(true);
    return () => {
      abortActiveRequest();
      setMaskVisible(false);
    };
  }, [abortActiveRequest, setMaskVisible]);

  const reset = useCallback(
    (close = false) => {
      abortActiveRequest();
      snapshotRef.current = undefined;
      resultTextsRef.current = [];
      setText("");
      setErrorMessage(undefined);
      setHasGeneratedText(false);
      setStatus("idle");
      if (close) {
        onClose();
      }
    },
    [abortActiveRequest, onClose],
  );

  const run = useCallback(
    async (request: PolishRequest, options: { preserveText?: boolean; snapshot?: SelectionSnapshot } = {}) => {
      if (request.action === RewriteActionType.ChatInDoc && !request.command.trim()) {
        toast.add({ type: "warning", title: "请输入指令" });
        return;
      }
      if (!onAiPolish) {
        toast.add({ type: "warning", title: "AI 润色能力未配置" });
        return;
      }

      const snapshot = options.snapshot ?? extractSelectionToBlocks(editor);
      if (snapshot.blocks.length === 0) {
        toast.add({ type: "warning", title: "未选中文本" });
        return;
      }
      if (!isSelectionSnapshotCurrent(editor, snapshot)) {
        toast.add({ type: "warning", title: "文档已变更，请重新选择内容后再试" });
        return;
      }

      abortActiveRequest();
      const controller = new AbortController();
      controllerRef.current = controller;
      const requestVersion = requestVersionRef.current;
      const isCurrentRequest = () => requestVersionRef.current === requestVersion && !controller.signal.aborted;

      snapshotRef.current = snapshot;
      resultTextsRef.current = [];
      lastRequestRef.current = request;
      setErrorMessage(undefined);
      if (!options.preserveText) {
        setHasGeneratedText(false);
        if (request.action !== RewriteActionType.ChatInDoc) {
          setText("");
        }
      }
      setStatus("loading");

      try {
        const stream = await onAiPolish(
          {
            action: request.action,
            command: request.command,
            selectedContent: snapshot.blocks.map((block) => ({ content: block.text, type: block.type })),
          },
          controller.signal,
        );
        if (!stream) {
          throw new TypeError("AI 润色未返回有效流");
        }

        let accumulated = "";
        for await (const token of parseSSEStream(stream, controller.signal)) {
          if (!isCurrentRequest()) {
            return;
          }
          accumulated += token;
          const partialText = extractTextFromPartialJson(accumulated);
          if (partialText) {
            setHasGeneratedText(true);
            setText(partialText);
          }
        }
        if (!isCurrentRequest()) {
          return;
        }

        const texts = parseAiPolishResult(accumulated, snapshot.blocks.length);
        resultTextsRef.current = texts;
        setText(texts.join("\n"));
        setHasGeneratedText(true);
        setStatus("ready");
      } catch (error) {
        if (!isCurrentRequest() || (error as { name?: string }).name === "AbortError") {
          return;
        }
        const message = (error as { message?: string }).message || "AI 润色失败，请稍后重试";
        setErrorMessage(message);
        setStatus("error");
        toast.add({
          type: "warning",
          title: message,
        });
      } finally {
        if (requestVersionRef.current === requestVersion) {
          controllerRef.current = undefined;
        }
      }
    },
    [abortActiveRequest, editor, onAiPolish],
  );

  const stop = useCallback(() => {
    abortActiveRequest();
    resultTextsRef.current = [];
    setErrorMessage(undefined);
    setStatus("cancelled");
    toast.add({ type: "warning", title: "已停止生成" });
  }, [abortActiveRequest]);

  const retry = useCallback(() => {
    const snapshot = snapshotRef.current;
    if (!lastRequestRef.current || !snapshot) {
      return;
    }
    if (!isSelectionSnapshotCurrent(editor, snapshot)) {
      toast.add({ type: "warning", title: "文档已变更，请重新选择内容后再试" });
      return;
    }
    void run(lastRequestRef.current, { preserveText: true, snapshot });
  }, [editor, run]);

  const replace = useCallback(() => {
    if (status !== "ready" || !snapshotRef.current || resultTextsRef.current.length === 0) {
      return;
    }
    if (!applyBlocksToSelection(editor, snapshotRef.current, resultTextsRef.current)) {
      toast.add({ type: "warning", title: "文档已变更，请重新选择内容后再试" });
      return;
    }
    toast.add({ type: "success", title: "AI 润色成功" });
    reset(true);
  }, [editor, reset, status]);

  const insert = useCallback(() => {
    const snapshot = snapshotRef.current;
    if (status !== "ready" || !snapshot || resultTextsRef.current.length === 0) {
      toast.add({ type: "warning", title: "文档已变更，请重新选择内容后再试" });
      return;
    }
    if (!insertBlocksAfterSelection(editor, snapshot, resultTextsRef.current)) {
      toast.add({ type: "warning", title: "无法在当前位置插入润色结果" });
      return;
    }
    toast.add({ type: "success", title: "AI 插入成功" });
    reset(true);
  }, [editor, reset, status]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.add({ type: "success", title: "复制成功" });
    } catch {
      toast.add({ type: "warning", title: "复制失败" });
    }
  }, [text]);

  return {
    copy,
    errorMessage,
    hasGeneratedText,
    insert,
    replace,
    reset,
    retry,
    run,
    setText,
    status,
    stop,
    text,
  };
};

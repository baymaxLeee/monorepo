import {
  getConversationAgentRunInput,
  listConversationAgentRunInputs,
  submitConversationAgentRunInput,
  type AgentRunInputStatus,
} from "@repo/api/chat";
import { randomId } from "@repo/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { PendingAgentInput } from "../components/PendingInputStack";

type PendingInput = AgentRunInputStatus;

function samePendingInput(previous: PendingInput, next: PendingInput) {
  return (
    previous.clientMessageId === next.clientMessageId &&
    previous.mode === next.mode &&
    previous.reason === next.reason &&
    previous.runId === next.runId &&
    previous.state === next.state &&
    previous.stepNumber === next.stepNumber &&
    previous.text === next.text
  );
}

export function reconcilePendingInputs(current: PendingInput[], results: readonly (PendingInput | null)[]) {
  const updates = new Map(results.filter((input) => input !== null).map((input) => [input.clientMessageId, input]));
  let changed = false;
  const next = current.flatMap((input) => {
    const update = updates.get(input.clientMessageId);
    if (!update) return [input];
    if (update.state === "delivered") {
      changed = true;
      return [];
    }
    if (samePendingInput(input, update)) return [input];
    changed = true;
    return [update];
  });
  return changed ? next : current;
}

export function removeDeliveredPendingInputs(current: PendingInput[], deliveredIds: ReadonlySet<string>) {
  if (deliveredIds.size === 0) return current;
  const next = current.filter((input) => !deliveredIds.has(input.clientMessageId));
  return next.length === current.length ? current : next;
}

export function useAgentRunInputs({
  conversationId,
  activeRunId,
  recoveryRunId,
}: {
  conversationId: string;
  activeRunId: string | null;
  recoveryRunId: string | null;
}) {
  const [pending, setPending] = useState<PendingInput[]>([]);

  useEffect(() => {
    setPending([]);
  }, [conversationId]);

  useEffect(() => {
    if (!recoveryRunId) return;
    let active = true;
    void listConversationAgentRunInputs(conversationId, recoveryRunId, { skipErrorNotify: true })
      .then((inputs) => {
        if (!active) return;
        setPending((current) => {
          const recovered = new Map(
            inputs
              .filter((input) => input.state !== "delivered")
              .map((input) => [input.clientMessageId, input] as const),
          );
          for (const input of current) {
            if (!recovered.has(input.clientMessageId)) recovered.set(input.clientMessageId, input);
          }
          return [...recovered.values()];
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [conversationId, recoveryRunId]);

  const admit = useCallback(
    async (text: string, mode: "follow-up" | "next-turn" = "follow-up") => {
      if (!activeRunId) throw new Error("当前运行标识尚未确认，请稍后重试");
      const clientMessageId = randomId().replaceAll("-", "");
      const input = await submitConversationAgentRunInput(
        conversationId,
        activeRunId,
        {
          expected_run_id: activeRunId,
          client_message_id: clientMessageId,
          text,
          mode,
        },
        { skipErrorNotify: true },
      );
      setPending((current) =>
        current.some((item) => item.clientMessageId === input.clientMessageId) ? current : [...current, input],
      );
      return input;
    },
    [activeRunId, conversationId],
  );

  const acknowledgeDelivered = useCallback((deliveredIds: ReadonlySet<string>) => {
    setPending((current) => removeDeliveredPendingInputs(current, deliveredIds));
  }, []);

  useEffect(() => {
    const pollable = pending.filter((input) => input.state === "accepted" || input.state === "dispatching");
    if (pollable.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all(
        pollable.map((input) =>
          getConversationAgentRunInput(conversationId, input.runId, input.clientMessageId, {
            skipErrorNotify: true,
          }).catch(() => null),
        ),
      ).then((results) => {
        if (cancelled) return;
        setPending((current) => reconcilePendingInputs(current, results));
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [conversationId, pending]);

  const visible = useMemo<PendingAgentInput[]>(
    () =>
      pending.flatMap((input) =>
        input.state === "accepted" ||
        input.state === "dispatching" ||
        input.state === "not_delivered" ||
        input.state === "unconfirmed"
          ? [
              {
                id: input.clientMessageId,
                text: input.text,
                mode: input.mode,
                state: input.state,
              },
            ]
          : [],
      ),
    [pending],
  );

  return { acknowledgeDelivered, admit, pendingInputs: visible };
}

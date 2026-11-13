import {
  getConversationAgentSteeringInput,
  listConversationAgentSteeringInputs,
  steerConversationAgentRun,
  type AgentSteeringInputStatus,
} from "@repo/api/chat";
import { randomId } from "@repo/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { PendingAgentInput } from "../components/PendingInputStack";

type PendingInput = AgentSteeringInputStatus;

export function useAgentSteering({
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
    void listConversationAgentSteeringInputs(conversationId, recoveryRunId, { skipErrorNotify: true })
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
    async (text: string, delivery: "steer" | "queue" = "steer") => {
      if (!activeRunId) throw new Error("当前运行标识尚未确认，请稍后重试");
      const clientMessageId = randomId().replaceAll("-", "");
      const input = await steerConversationAgentRun(
        conversationId,
        activeRunId,
        {
          expected_run_id: activeRunId,
          client_message_id: clientMessageId,
          text,
          delivery,
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

  useEffect(() => {
    const pollable = pending.filter((input) => input.state === "accepted" || input.state === "dispatching");
    if (pollable.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all(
        pollable.map((input) =>
          getConversationAgentSteeringInput(conversationId, input.runId, input.clientMessageId, {
            skipErrorNotify: true,
          }).catch(() => null),
        ),
      ).then((results) => {
        if (cancelled) return;
        const updates = new Map(
          results.filter((input) => input !== null).map((input) => [input.clientMessageId, input]),
        );
        setPending((current) =>
          current.flatMap((input) => {
            const next = updates.get(input.clientMessageId);
            if (!next) return [input];
            return next.state === "delivered" ? [] : [next];
          }),
        );
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
                delivery: input.delivery,
                state: input.state,
              },
            ]
          : [],
      ),
    [pending],
  );

  return { admit, pendingInputs: visible };
}

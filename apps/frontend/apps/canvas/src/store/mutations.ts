import { atom, useStore } from "jotai";
import { useMemo } from "react";

const coordinatorAtom = atom({ epoch: 0, pending: 0, tail: Promise.resolve() });
export const canvasBusyAtom = atom((get) => get(coordinatorAtom).pending > 0);

export function useStudioMutationCoordinator() {
  const store = useStore();
  return useMemo(
    () => ({
      enqueue<T>(mutation: () => Promise<T>) {
        const current = store.get(coordinatorAtom);
        const result = current.tail.then(mutation, mutation);
        const settled = result
          .then(
            () => undefined,
            () => undefined,
          )
          .then(() => {
            store.set(coordinatorAtom, (latest) => ({ ...latest, pending: latest.pending - 1 }));
          });
        store.set(coordinatorAtom, { epoch: current.epoch + 1, pending: current.pending + 1, tail: settled });
        return result;
      },
      snapshotEpoch: () => store.get(coordinatorAtom).epoch,
      isSnapshotCurrent: (epoch: number) => store.get(coordinatorAtom).epoch === epoch,
      async waitForIdle() {
        for (;;) {
          const tail = store.get(coordinatorAtom).tail;
          await tail;
          if (store.get(coordinatorAtom).tail === tail) return;
        }
      },
    }),
    [store],
  );
}

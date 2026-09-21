import { atom, useStore } from "jotai";
import { useMemo } from "react";

type MutationCoordinatorState = {
  mutationEpoch: number;
  tail: Promise<void>;
};

const mutationCoordinatorAtom = atom<MutationCoordinatorState>({
  mutationEpoch: 0,
  tail: Promise.resolve(),
});

/**
 * Canvas 与 Storyboard 共用同一个页面级写入顺序；外层 Provider 以 CanvasID
 * 为 key，因此切换画布或离开 Studio 后队列和 epoch 会一起销毁。
 */
export function useStudioMutationCoordinator() {
  const store = useStore();

  return useMemo(
    () => ({
      enqueue<T>(mutation: () => Promise<T>) {
        const current = store.get(mutationCoordinatorAtom);
        const result = current.tail.then(mutation, mutation);
        store.set(mutationCoordinatorAtom, {
          ...current,
          mutationEpoch: current.mutationEpoch + 1,
          tail: result.then(
            () => undefined,
            () => undefined,
          ),
        });
        return result;
      },

      snapshotEpoch: () => store.get(mutationCoordinatorAtom).mutationEpoch,

      async waitForIdle() {
        for (;;) {
          const tail = store.get(mutationCoordinatorAtom).tail;
          await tail;
          if (store.get(mutationCoordinatorAtom).tail === tail) {
            return;
          }
        }
      },

      isSnapshotCurrent: (epoch: number) => store.get(mutationCoordinatorAtom).mutationEpoch === epoch,
    }),
    [store],
  );
}

import { atom, useStore } from "jotai";
import { useMemo } from "react";

const tailAtom = atom<Promise<void>>(Promise.resolve());
/** HTTP receipts wait for the page stream; serial commands then read observed state. */
export function useStudioMutationCoordinator() {
  const store = useStore();
  return useMemo(
    () => ({
      enqueue<T>(mutation: () => Promise<T>) {
        const result = store.get(tailAtom).then(mutation, mutation);
        store.set(
          tailAtom,
          result.then(
            () => undefined,
            () => undefined,
          ),
        );
        return result;
      },
    }),
    [store],
  );
}

import { type RefObject, useEffect, useState } from "react";

export function useInView<T extends Element>(ref: RefObject<T | null>, options?: { rootMargin?: string }): boolean {
  const [inView, setInView] = useState(false);
  const rootMargin = options?.rootMargin ?? "200px";

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          return;
        }
        setInView(true);
        observer.disconnect();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, ref, rootMargin]);

  return inView;
}

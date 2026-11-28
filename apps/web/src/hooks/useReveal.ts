import { useEffect, useRef, useState } from "react";

/** Scroll reveal: `data-in` flips once the element is near the viewport. Without IntersectionObserver (old browsers, jsdom) it is visible at once; reduced-motion users get the CSS override. */
export function useReveal<T extends Element>(rootMargin = "0px 0px -8% 0px") {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin, threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, rootMargin]);
  return [ref, seen] as const;
}

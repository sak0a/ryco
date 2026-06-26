/**
 * Shared motion helpers. Versions may use these or roll their own — they exist
 * so common patterns (scroll reveal, parallax, GSAP context cleanup) are not
 * reimplemented five times. All helpers no-op under prefers-reduced-motion.
 */
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Run GSAP code inside a scoped context bound to a container ref. The callback
 * receives the gsap instance; everything is reverted automatically on unmount.
 */
export function useGsapContext(
  setup: (ctx: { gsap: typeof gsap; ScrollTrigger: typeof ScrollTrigger }) => void,
  deps: ReadonlyArray<unknown> = [],
) {
  const scope = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const ctx = gsap.context(() => setup({ gsap, ScrollTrigger }), scope);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return scope;
}

/**
 * Reveal children matching `selector` on scroll with a staggered rise.
 */
export function useScrollReveal(
  selector = "[data-reveal]",
  opts: { y?: number; stagger?: number; duration?: number } = {},
) {
  return useGsapContext(({ gsap }) => {
    const { y = 28, stagger = 0.08, duration = 0.8 } = opts;
    const els = gsap.utils.toArray<HTMLElement>(selector);
    els.forEach((el) => {
      gsap.from(el, {
        opacity: 0,
        y,
        duration,
        ease: "power3.out",
        stagger,
        scrollTrigger: { trigger: el, start: "top 85%", once: true },
      });
    });
  });
}

export { gsap, ScrollTrigger };

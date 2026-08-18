/**
 * AgentDeck — the "every agent, side by side" gallery.
 *
 * Desktop: a pinned horizontal scroll where the six providers glide past as a
 * 3D coverflow — the card nearest the centre faces you head-on while its
 * neighbours rotate away, scale down and dim. Scrolling down drives the sideways
 * motion (GSAP ScrollTrigger pin + scrub); a per-frame pass reads each card's
 * position and applies the perspective.
 *
 * Touch / narrow viewports get a native horizontal scroll-snap carousel, and the
 * whole thing is gated behind prefers-reduced-motion by the parent (which renders
 * a static grid instead).
 */
import { useRef } from "react";
import { MoveRight, MousePointer2 } from "lucide-react";
import { useGsapContext } from "@/lib/motion";
import { PROVIDERS } from "@/data/content";
import { ScreenshotFrame } from "@/components/shared/ScreenshotFrame";
import { ProviderCard } from "./ProviderCard";
import { ACCENT } from "./theme";

const MAX_TILT = 24; // deg of coverflow rotation at the edges

export function AgentDeck() {
  const pinRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const progRef = useRef<HTMLDivElement>(null);
  const tiltRefs = useRef<Array<HTMLElement | null>>([]);

  const scope = useGsapContext(({ gsap, ScrollTrigger }) => {
    const track = trackRef.current;
    const pin = pinRef.current;
    if (!track || !pin) return;

    // Desktop pin only — drive it through matchMedia so crossing the breakpoint
    // (e.g. resize / rotate) builds and reverts the animation instead of leaving
    // the pin running over the mobile layout.
    const mm = gsap.matchMedia();
    mm.add("(min-width: 1024px)", () => {
      const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);

      /* Per-frame coverflow: tilt/scale/dim each card by its distance from centre. */
      const coverflow = () => {
        const r = pin.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return; // offscreen — skip
        const cx = window.innerWidth / 2;
        for (const card of tiltRefs.current) {
          if (!card) continue;
          const b = card.getBoundingClientRect();
          const d = gsap.utils.clamp(
            -1.15,
            1.15,
            (b.left + b.width / 2 - cx) / (window.innerWidth * 0.42),
          );
          gsap.set(card, {
            rotationY: -d * MAX_TILT,
            scale: 1 - Math.min(0.18, Math.abs(d) * 0.18),
            z: -Math.abs(d) * 220,
            opacity: 1 - Math.min(0.55, Math.abs(d) * 0.62),
          });
        }
      };

      gsap.to(track, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: pin,
          start: "top top",
          end: () => "+=" + distance(),
          scrub: 0.6,
          pin: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            if (progRef.current) gsap.set(progRef.current, { scaleX: self.progress });
          },
        },
      });

      gsap.ticker.add(coverflow);
      coverflow();
      ScrollTrigger.refresh();

      // matchMedia runs this cleanup when the query stops matching; the tween,
      // ScrollTrigger and pin it created are reverted automatically.
      return () => gsap.ticker.remove(coverflow);
    });

    // gsap.context (via useGsapContext) calls a returned cleanup on revert.
    return () => mm.revert();
  });

  const registerTilt = (el: HTMLElement | null, i: number) => {
    tiltRefs.current[i] = el;
  };
  const FINALE = PROVIDERS.length;

  return (
    <div ref={scope}>
      {/* ---- desktop: pinned horizontal 3D coverflow ---- */}
      <div
        ref={pinRef}
        className="relative hidden h-screen items-center overflow-hidden lg:flex"
        style={{ perspective: "1800px" }}
      >
        <div
          ref={trackRef}
          className="flex w-max items-center gap-6 pl-[8vw] pr-[40vw] will-change-transform"
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* intro panel */}
          <div className="flex w-[34vw] max-w-[440px] shrink-0 flex-col justify-center pr-4">
            <p className="inline-flex items-center gap-2 font-['JetBrains_Mono'] text-[11px] font-medium uppercase tracking-[0.22em] text-white/55">
              <span aria-hidden className="h-px w-6" style={{ background: ACCENT }} />
              The line-up
            </p>
            <p className="mt-5 font-['Space_Grotesk'] text-3xl font-bold leading-tight tracking-[-0.02em] sm:text-4xl">
              Six agents,
              <br />
              one continuous surface.
            </p>
            <p className="mt-4 text-white/55">
              Authenticate once on the command line, then run them all side by side — with full
              visibility into what each one does.
            </p>
            <p
              className="mt-7 inline-flex items-center gap-2 font-['JetBrains_Mono'] text-xs uppercase tracking-widest"
              style={{ color: ACCENT }}
            >
              Keep scrolling <MoveRight className="size-4" />
            </p>
          </div>

          {PROVIDERS.map((p, i) => (
            <div
              key={p.id}
              ref={(el) => registerTilt(el, i)}
              className="w-[30vw] max-w-[400px] shrink-0 will-change-transform"
              style={{ transformStyle: "preserve-3d" }}
            >
              <ProviderCard p={p} index={i} variant="deck" />
            </div>
          ))}

          {/* real screenshot finale */}
          <div
            ref={(el) => registerTilt(el, FINALE)}
            className="w-[52vw] max-w-[760px] shrink-0 will-change-transform"
            style={{ transformStyle: "preserve-3d" }}
          >
            <ScreenshotFrame
              src="/shots/providers.png"
              alt="Ryco settings showing provider instances authenticated with live version and subscription status."
              theme="dark"
              chrome={false}
              className="shadow-[0_40px_120px_-50px_rgba(0,0,0,0.9)]"
            />
            <p className="mt-4 text-sm text-white/50">Authenticated and live.</p>
          </div>
        </div>

        {/* scroll affordance + horizontal progress */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 bottom-7 flex items-center gap-4"
        >
          <span className="inline-flex items-center gap-2 font-['JetBrains_Mono'] text-[11px] uppercase tracking-[0.22em] text-white/40">
            <MousePointer2 className="size-3.5" /> Scroll to pan
          </span>
          <span className="relative h-px flex-1 overflow-hidden bg-white/10">
            <span
              ref={progRef}
              className="absolute inset-0 origin-left scale-x-0"
              style={{ background: ACCENT, boxShadow: `0 0 12px ${ACCENT}` }}
            />
          </span>
        </div>
      </div>

      {/* ---- mobile / touch: native horizontal scroll-snap ---- */}
      <div className="lg:hidden">
        <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {PROVIDERS.map((p, i) => (
            <div key={p.id} className="w-[80vw] max-w-[340px] shrink-0 snap-center">
              <ProviderCard p={p} index={i} />
            </div>
          ))}
        </div>
        <div className="mx-auto mt-8 max-w-md px-5">
          <ScreenshotFrame
            src="/shots/providers.png"
            alt="Ryco settings showing provider instances authenticated."
            theme="dark"
            chrome={false}
            className="shadow-[0_30px_90px_-50px_rgba(0,0,0,0.9)]"
          />
        </div>
      </div>
    </div>
  );
}

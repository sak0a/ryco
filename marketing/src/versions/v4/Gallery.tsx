/**
 * Gallery — the "under the hood" deep-dive.
 *
 * A vertical run of real dark-mode captures that fly in on a 3D plane as you
 * scroll: each card swings in from its side (alternating), rotating on Y and
 * rising out of depth, scrubbed to the scroll position. Copy sits opposite.
 *
 * The intro state is set by GSAP (not CSS), so under prefers-reduced-motion —
 * where useGsapContext never runs — every card simply renders flat and visible.
 */
import { ArrowUpRight } from "lucide-react";
import { useGsapContext } from "@/lib/motion";
import { ScreenshotFrame } from "@/components/shared/ScreenshotFrame";
import { cn } from "@/lib/cn";
import { ACCENT } from "./theme";

interface Shot {
  shot: string;
  alt: string;
  eyebrow: string;
  title: string;
  body: string;
}

const ITEMS: Shot[] = [
  {
    shot: "/shots/files.png",
    alt: "Ryco file explorer with the workspace tree and a previewed test file.",
    eyebrow: "Workspace",
    title: "The whole tree, previewed.",
    body: "Browse and preview any file in the workspace — code, tests, configs — side by side with the tree, without leaving Ryco.",
  },
  {
    shot: "/shots/diff.png",
    alt: "Ryco review panel showing a syntax-highlighted diff with per-turn history.",
    eyebrow: "Review",
    title: "Every change, per turn.",
    body: "A full diff with per-turn history and hunk search. Click any line to open your editor at the exact file and line.",
  },
  {
    shot: "/shots/instance.png",
    alt: "Ryco named-instance settings — usage limits, accent colour, env vars and binary path.",
    eyebrow: "Instances",
    title: "Named instances, your env.",
    body: "Run several of the same agent at once — each with independent env vars, accent, binary path, usage windows and models.",
  },
  {
    shot: "/shots/plugins.png",
    alt: "Ryco token-mode settings with opinionated plugins like RTK and Caveman.",
    eyebrow: "Tokens",
    title: "Token modes & plugins.",
    body: "Pick a default token mode, then layer opinionated plugins — RTK, Caveman, Token Optimizer — to compress noisy output before agents read it.",
  },
  {
    shot: "/shots/actions.png",
    alt: "Ryco showing GitHub Actions workflow runs per branch with pass and fail badges.",
    eyebrow: "CI",
    title: "Workflow runs, inline.",
    body: "Watch branch workflow runs and their checks — passed, failed, re-run failed jobs — straight from GitHub, GitLab and more.",
  },
  {
    shot: "/shots/project.png",
    alt: "Ryco project settings — project image, display name and linked repositories.",
    eyebrow: "Project",
    title: "Repos & remotes.",
    body: "A per-project image and name, plus linked repositories — pick exactly which remote the sidebar's “Open remote” uses.",
  },
];

export function Gallery() {
  const scope = useGsapContext(({ gsap, ScrollTrigger }) => {
    gsap.utils.toArray<HTMLElement>("[data-fly]").forEach((el) => {
      const dir = Number(el.dataset.fly) || 1; // 1 = from right, -1 = from left
      gsap.fromTo(
        el,
        {
          opacity: 0,
          xPercent: 22 * dir,
          rotationY: -15 * dir,
          z: -260,
          transformPerspective: 1200,
          transformOrigin: "center",
        },
        {
          opacity: 1,
          xPercent: 0,
          rotationY: 0,
          z: 0,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%", end: "top 46%", scrub: 0.8 },
        },
      );
    });
    ScrollTrigger.refresh();
  });

  return (
    <div ref={scope} className="mt-16 space-y-24 sm:space-y-32">
      {ITEMS.map((it, i) => {
        const dir = i % 2 === 0 ? 1 : -1; // alternate sides
        return (
          <div key={it.shot} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
            <div className={cn(dir === -1 && "lg:order-2")}>
              <div data-fly={dir} className="will-change-transform">
                <ScreenshotFrame
                  src={it.shot}
                  alt={it.alt}
                  theme="dark"
                  chrome={false}
                  className="shadow-[0_50px_140px_-50px_rgba(0,0,0,0.9)]"
                />
              </div>
            </div>
            <div className={cn(dir === -1 && "lg:order-1")}>
              <p className="inline-flex items-center gap-2 font-['JetBrains_Mono'] text-[11px] font-medium uppercase tracking-[0.22em] text-white/55">
                <span aria-hidden className="h-px w-6" style={{ background: ACCENT }} />
                {it.eyebrow}
              </p>
              <h3 className="mt-4 font-['Space_Grotesk'] text-2xl font-semibold tracking-[-0.015em] text-white sm:text-3xl">
                {it.title}
              </h3>
              <p className="mt-4 max-w-md text-white/60 sm:text-lg">{it.body}</p>
              <span
                aria-hidden
                className="mt-6 inline-flex items-center gap-1.5 font-['JetBrains_Mono'] text-xs uppercase tracking-widest"
                style={{ color: ACCENT }}
              >
                {String(i + 1).padStart(2, "0")} <ArrowUpRight className="size-3.5" />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

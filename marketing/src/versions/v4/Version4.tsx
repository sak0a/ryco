/**
 * Version 4 — "Kinetic" (motion-led art direction).
 *
 * An awwwards-style, scroll-driven showcase where motion *is* the headline
 * feature: a cinematic hero reveal, a pinned horizontal agent gallery, a sticky
 * scrollytelling sequence that swaps the real product screenshots as the copy
 * changes, a kinetic marquee, parallax depth and a drawn-on timeline.
 *
 * Refined dark canvas (charcoal #0a0b0d), high-contrast white type and ONE
 * confident accent — electric lime #c6ff3a — used sparingly for kinetic
 * punctuation. Everything is transforms/opacity only and degrades to a clean,
 * fully-visible STATIC stacked layout under prefers-reduced-motion: pinned and
 * horizontal sections are simply never constructed, so there is never a blank
 * pinned frame.
 */
import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  Boxes,
  GitBranch,
  TerminalSquare,
  Paperclip,
  FileDiff,
  Palette,
  Command,
  Keyboard,
  Plug,
  GitPullRequest,
  Radio,
  RefreshCw,
  Activity,
  Zap,
  ShieldCheck,
  Eye,
  Download,
  Github,
  ArrowRight,
  ArrowUpRight,
  Copy,
  Check,
  Plus,
  Minus,
  MessagesSquare,
  MoveRight,
  type LucideIcon,
} from "lucide-react";
import {
  SITE,
  PROVIDERS,
  MODEL_PROVIDERS,
  PLATFORMS,
  FEATURES,
  STATS,
  PILLARS,
  STEPS,
  FAQ,
  type Provider,
} from "@/data/content";
import { BrandIcon, type BrandKey } from "@/assets/brands";
import { RycoWordmark, RycoMark } from "@/assets/RycoLogo";
import { ScreenshotFrame } from "@/components/shared/ScreenshotFrame";
import { useGsapContext, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/cn";

const ACCENT = "#c6ff3a";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c6ff3a]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b0d]";

const NAV_OFFSET = "scroll-mt-24";

const ICONS: Record<string, LucideIcon> = {
  LayoutGrid,
  Boxes,
  GitBranch,
  TerminalSquare,
  Paperclip,
  FileDiff,
  Palette,
  Command,
  Keyboard,
  Plug,
  GitPullRequest,
  Radio,
  RefreshCw,
  Activity,
  Zap,
  ShieldCheck,
  Eye,
};

/* Example named provider instances — Ryco runs several of the same agent at once. */
const INSTANCE_EXAMPLES = [
  "codex_personal",
  "claude_openrouter",
  "copilot_work",
  "opencode_self",
  "cursor_ea",
];

const MARQUEE_ITEMS = [
  "Worktrees",
  "Diff → editor",
  "Multi-terminal",
  "Command palette",
  "Named instances",
  "MCP servers",
  "Remote environments",
  "Custom themes",
  "Rebindable keys",
  "Observability",
];

interface ShowcaseStep {
  shot: string;
  title: string;
  alt: string;
  eyebrow: string;
  heading: string;
  body: string;
  points: string[];
}

const SHOWCASE: ShowcaseStep[] = [
  {
    shot: "/shots/overview.png",
    title: "Project overview",
    alt: "Ryco project overview with git worktrees grouped by status.",
    eyebrow: "Worktrees",
    heading: "A worktree for every branch, PR and issue.",
    body: "Create and track git worktrees per branch, pull request, issue or Jira item — bucketed by status: idle, in progress, review and done. Switch context without stashing a thing.",
    points: ["Status buckets", "Branch selector", "Symlink-aware paths"],
  },
  {
    shot: "/shots/model-picker.png",
    title: "Model picker",
    alt: "Ryco model picker showing multiple providers and their models.",
    eyebrow: "Models",
    heading: "Switch models mid-thread.",
    body: "Pick any provider and model from a single picker — Claude, Codex, Copilot and whatever your OpenCode upstreams expose. Reasoning effort and interaction mode are right there too.",
    points: ["One picker, every provider", "Per-thread memory", "Usage windows inline"],
  },
  {
    shot: "/shots/terminal.png",
    title: "Terminal drawer",
    alt: "Ryco terminal drawer open beneath an agent thread.",
    eyebrow: "Terminal",
    heading: "Terminals, diffs and your editor — together.",
    body: "Split terminals in a drawer with clickable file and path links. Search inside large diffs, then click any line to open your editor at the exact file and line.",
    points: ["Multi-terminal drawer", "Diff occurrence search", "Diff line → editor"],
  },
  {
    shot: "/shots/command-palette.png",
    title: "⌘K",
    alt: "Ryco command palette open over an agent thread.",
    eyebrow: "Command palette",
    heading: "Everything, a keystroke away.",
    body: "Jump between threads, projects and models, run commands, attach a GitHub or GitLab issue with #, or fire a slash command — all without leaving the keyboard.",
    points: ["Thread & model jumps", "Reference issues / PRs", "Slash commands"],
  },
  {
    shot: "/shots/composer.png",
    title: "Composer",
    alt: "Ryco composer attaching a GitHub issue as structured context.",
    eyebrow: "Composer",
    heading: "Bring exactly the right context.",
    body: "Attach GitHub, GitLab, Forgejo, Bitbucket or Azure DevOps issues and PRs as structured context with a # trigger — straight from the composer, before the agent starts.",
    points: ["# to attach", "Structured context", "Five SCM providers"],
  },
  {
    shot: "/shots/appearance.png",
    title: "Settings — Appearance",
    alt: "Ryco appearance settings with font pickers and theme controls.",
    eyebrow: "Appearance",
    heading: "Make it unmistakably yours.",
    body: "A full theme editor with live preview, independent interface and code fonts, text size, corner radius and a pinnable accent — plus rebindable shortcuts for everything.",
    points: ["Custom themes", "Font pickers", "Rebindable keys"],
  },
];

/* ------------------------------- small hook -------------------------------- */

/** Read prefers-reduced-motion once on mount; gates the motion-only layouts. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => prefersReducedMotion());
  useEffect(() => setReduced(prefersReducedMotion()), []);
  return reduced;
}

/* ------------------------------- primitives -------------------------------- */

function Copyable({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          },
          () => {},
        );
      }}
      className={cn(
        "group/c inline-flex items-center gap-3 rounded-xl border border-white/12 bg-white/[0.04] px-4 py-2.5 font-['JetBrains_Mono'] text-[13px] text-white/85 backdrop-blur-sm transition hover:border-[#c6ff3a]/40 hover:bg-white/[0.06]",
        focusRing,
        className,
      )}
      aria-label={copied ? `Copied ${text} to clipboard` : `Copy command: ${text}`}
    >
      <span style={{ color: ACCENT }} className="select-none">
        $
      </span>
      <span className="truncate">{text.replace(/^\$ ?/, "")}</span>
      <span className="ml-1 text-white/50 transition group-hover/c:text-white/80">
        {copied ? <Check className="size-3.5" style={{ color: ACCENT }} /> : <Copy className="size-3.5" />}
      </span>
    </button>
  );
}

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 font-['JetBrains_Mono'] text-[11px] font-medium uppercase tracking-[0.22em] text-white/55",
        className,
      )}
    >
      <span aria-hidden className="h-px w-6" style={{ background: ACCENT }} />
      {children}
    </p>
  );
}

/** Section heading with a per-line clip-mask reveal (gated by [data-line-reveal]). */
function SectionHeading({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <h2
      id={id}
      className={cn(
        "font-['Space_Grotesk'] text-4xl font-bold tracking-[-0.02em] sm:text-5xl",
        className,
      )}
    >
      <span className="block overflow-hidden pb-[0.08em]">
        <span data-line-reveal className="block">
          {children}
        </span>
      </span>
    </h2>
  );
}

function ProviderCard({ p, index }: { p: Provider; index: number }) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-7 transition-colors duration-300 hover:border-white/20 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 size-44 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: p.accent }}
      />
      <div className="relative flex items-center justify-between">
        <span
          className="grid size-14 place-items-center rounded-2xl border"
          style={{
            color: p.accent,
            borderColor: `${p.accent}40`,
            background: `${p.accent}12`,
          }}
        >
          <BrandIcon name={p.brand as BrandKey} className="size-7" />
        </span>
        <span className="font-['JetBrains_Mono'] text-sm tabular-nums text-white/25">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>

      <div className="relative mt-6 flex items-center gap-2.5">
        <h3 className="font-['Space_Grotesk'] text-2xl font-semibold tracking-[-0.01em] text-white">
          {p.name}
        </h3>
        {p.earlyAccess && (
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: ACCENT, borderColor: `${ACCENT}55`, background: `${ACCENT}14` }}
          >
            Early access
          </span>
        )}
      </div>
      <p className="relative mt-1 font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-white/55">
        {p.vendor} · {p.blurb}
      </p>
      <p className="relative mt-5 text-[15px] leading-relaxed text-white/65">{p.detail}</p>
    </article>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const numeric = /^\d+$/.test(value);
  return (
    <div data-reveal className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 sm:p-7">
      <div
        className="font-['Space_Grotesk'] text-5xl font-bold tracking-[-0.02em] sm:text-6xl"
        style={{ color: ACCENT }}
      >
        {numeric ? <span data-count={value}>{value}</span> : value}
      </div>
      <p className="mt-3 text-sm leading-snug text-white/55">{label}</p>
    </div>
  );
}

function FaqRow({
  q,
  a,
  open,
  onToggle,
}: {
  q: string;
  a: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-white/[0.02] transition-colors",
        open ? "border-[#c6ff3a]/35" : "border-white/10",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn("flex w-full items-center gap-4 px-5 py-4 text-left sm:px-6", focusRing)}
      >
        <span className="flex-1 font-['Space_Grotesk'] text-base font-medium text-white sm:text-lg">
          {q}
        </span>
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full border text-white/70"
          style={open ? { color: ACCENT, borderColor: `${ACCENT}66` } : { borderColor: "rgba(255,255,255,0.18)" }}
        >
          {open ? <Minus className="size-4" /> : <Plus className="size-4" />}
        </span>
      </button>
      <div className="grid transition-all duration-300 ease-out" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-sm leading-relaxed text-white/65 sm:px-6 sm:text-[15px]">{a}</p>
        </div>
      </div>
    </div>
  );
}

/** Fixed, version-agnostic kinetic backdrop: faint grid + a single lime glow. */
function KineticBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0a0b0d]">
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 80%)",
        }}
      />
      <div
        className="absolute -top-[18%] left-1/2 size-[60vw] max-w-[820px] -translate-x-1/2 rounded-full blur-[140px]"
        style={{ background: `${ACCENT}1f` }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, transparent 45%, rgba(10,11,13,0.6) 100%), linear-gradient(180deg, rgba(10,11,13,0.2), transparent 22%, rgba(10,11,13,0.55))",
        }}
      />
    </div>
  );
}

/* ---------------------------------- page ----------------------------------- */

export default function Version4() {
  const reduced = useReducedMotion();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [activeShot, setActiveShot] = useState(0);

  const headerRef = useRef<HTMLElement>(null);
  const heroShotRef = useRef<HTMLDivElement>(null);
  const hzPinRef = useRef<HTMLDivElement>(null);
  const hzTrackRef = useRef<HTMLDivElement>(null);

  const scope = useGsapContext(({ gsap, ScrollTrigger }) => {
    /* Refresh trigger positions as the large screenshots finish decoding. */
    gsap.utils.toArray<HTMLImageElement>("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
    });

    /* Sticky header hairline once you leave the hero. */
    ScrollTrigger.create({
      start: "top -8",
      onUpdate: (self) => {
        const el = headerRef.current;
        if (el) el.dataset.scrolled = self.scroll() > 8 ? "true" : "false";
      },
    });

    /* Hero — kinetic load entrance. */
    gsap.from("[data-hero-line]", { yPercent: 118, duration: 1, ease: "power4.out", stagger: 0.09 });
    gsap.from("[data-hero-fade]", {
      opacity: 0,
      y: 18,
      duration: 0.9,
      ease: "power3.out",
      stagger: 0.07,
      delay: 0.35,
    });

    /* Hero screenshot — cinematic clip-reveal on load + gentle parallax. */
    if (heroShotRef.current) {
      gsap.from(heroShotRef.current, {
        autoAlpha: 0,
        scale: 1.06,
        clipPath: "inset(9% 5% 12% 5% round 20px)",
        duration: 1.3,
        ease: "power3.out",
        delay: 0.45,
      });
      gsap.to(heroShotRef.current, {
        yPercent: -6,
        ease: "none",
        scrollTrigger: { trigger: heroShotRef.current, start: "top bottom", end: "bottom top", scrub: 0.6 },
      });
    }

    /* Hero accent underline draws in under "agents." */
    gsap.from("[data-hero-underline]", {
      scaleX: 0,
      transformOrigin: "left",
      duration: 0.9,
      ease: "power3.inOut",
      delay: 1.05,
    });

    /* Global scroll-progress bar. */
    gsap.to("[data-scroll-progress]", {
      scaleX: 1,
      transformOrigin: "left",
      ease: "none",
      scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
    });

    /* Section headings — per-line clip-mask reveal. */
    gsap.utils.toArray<HTMLElement>("[data-line-reveal]").forEach((el) => {
      gsap.from(el, {
        yPercent: 120,
        duration: 0.95,
        ease: "power4.out",
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      });
    });

    /* Marquee — seamless loop (content is duplicated, so -50% wraps cleanly),
       kinetic: it speeds up with scroll velocity and eases back when you stop. */
    const marqueeTweens = gsap.utils
      .toArray<HTMLElement>("[data-marquee]")
      .map((track) => gsap.to(track, { xPercent: -50, duration: 26, ease: "none", repeat: -1 }));
    if (marqueeTweens.length) {
      const speed = { ts: 1 };
      const applyTs = () => marqueeTweens.forEach((tw) => tw.timeScale(speed.ts));
      const tsTo = gsap.quickTo(speed, "ts", { duration: 0.5, ease: "power2", onUpdate: applyTs });
      let settle: ReturnType<typeof gsap.delayedCall> | undefined;
      ScrollTrigger.create({
        onUpdate: (self) => {
          tsTo(gsap.utils.clamp(1, 6, 1 + Math.abs(self.getVelocity()) / 520));
          settle?.kill();
          settle = gsap.delayedCall(0.2, () => tsTo(1));
        },
      });
    }

    /* Pinned horizontal agent gallery. */
    const track = hzTrackRef.current;
    const pin = hzPinRef.current;
    if (track && pin) {
      const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);
      gsap.to(track, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: pin,
          start: "top top",
          end: () => "+=" + distance(),
          scrub: 0.8,
          pin: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const bar = pin.querySelector<HTMLElement>("[data-hz-progress]");
            if (bar) gsap.set(bar, { scaleX: self.progress });
          },
        },
      });
    }

    /* Sticky scrollytelling — swap the active screenshot per step. */
    gsap.utils.toArray<HTMLElement>("[data-shot-step]").forEach((el, i) => {
      ScrollTrigger.create({
        trigger: el,
        start: "top 55%",
        end: "bottom 55%",
        onEnter: () => setActiveShot(i),
        onEnterBack: () => setActiveShot(i),
      });
    });

    /* How-it-works progress line draws as you scroll the timeline. */
    const prog = document.querySelector<HTMLElement>("[data-timeline-progress]");
    const timeline = document.querySelector<HTMLElement>("[data-timeline]");
    if (prog && timeline) {
      gsap.fromTo(
        prog,
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: "none",
          transformOrigin: "top",
          scrollTrigger: { trigger: timeline, start: "top 70%", end: "bottom 80%", scrub: true },
        },
      );
    }

    /* Numeric stat count-ups. */
    gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el) => {
      const target = Number(el.dataset.count);
      el.textContent = "0";
      const obj = { v: 0 };
      gsap.to(obj, {
        v: target,
        duration: 1.2,
        ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
        onUpdate: () => {
          el.textContent = String(Math.round(obj.v));
        },
      });
    });

    /* Generic on-scroll reveals. */
    gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
      gsap.from(el, {
        opacity: 0,
        y: 28,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 86%", once: true },
      });
    });

    ScrollTrigger.refresh();
  });

  return (
    <div ref={scope} className="relative min-h-screen bg-[#0a0b0d] text-white antialiased">
      <KineticBackground />

      {/* global scroll-progress bar */}
      <div
        data-scroll-progress
        aria-hidden
        className="fixed left-0 top-0 z-[60] h-0.5 w-full origin-left scale-x-0"
        style={{ background: ACCENT, boxShadow: `0 0 12px ${ACCENT}` }}
      />

      {/* ---------------------------------- nav --------------------------------- */}
      <header
        ref={headerRef}
        data-scrolled="false"
        className="fixed inset-x-0 top-0 z-50 border-b border-transparent transition-colors duration-300 data-[scrolled=true]:border-white/10 data-[scrolled=true]:bg-[#0a0b0d]/75 data-[scrolled=true]:backdrop-blur-xl"
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className={cn("flex items-center gap-2.5 rounded-lg", focusRing)} aria-label="Ryco home">
            <RycoMark className="size-7 rounded-md" />
            <RycoWordmark className="h-[18px] text-white" />
          </a>
          <nav aria-label="Primary" className="hidden items-center gap-8 text-sm text-white/60 md:flex">
            <a href="#agents" className="transition hover:text-white">Agents</a>
            <a href="#showcase" className="transition hover:text-white">Workspace</a>
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#download" className="transition hover:text-white">Download</a>
            <a href="#faq" className="transition hover:text-white">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <a
              href={SITE.repo}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "hidden rounded-lg p-2 text-white/60 transition hover:bg-white/5 hover:text-white sm:inline-flex",
                focusRing,
              )}
              aria-label="Ryco on GitHub"
            >
              <Github className="size-[18px]" />
            </a>
            <a
              href={SITE.releases}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-[#0a0b0d] transition hover:brightness-95",
                focusRing,
              )}
              style={{ background: ACCENT }}
            >
              <Download className="size-4" /> Download
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* --------------------------------- hero -------------------------------- */}
        <section className="relative mx-auto max-w-7xl px-5 pb-16 pt-32 sm:px-8 sm:pt-40">
          <div className="mx-auto max-w-4xl text-center">
            <div data-hero-fade className="mb-7 flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3.5 py-1.5 text-[12px] text-white/65">
                <span className="size-1.5 rounded-full" style={{ background: ACCENT, boxShadow: `0 0 10px ${ACCENT}` }} />
                {SITE.status} · {SITE.license}
              </span>
            </div>

            <h1 className="font-['Space_Grotesk'] text-[clamp(2.7rem,8vw,6.25rem)] font-bold leading-[0.92] tracking-[-0.035em]">
              <span className="block overflow-hidden pb-[0.06em]">
                <span data-hero-line className="block">A fast local</span>
              </span>
              <span className="block overflow-hidden pb-[0.06em]">
                <span data-hero-line className="block">workspace for</span>
              </span>
              <span className="block overflow-hidden pb-[0.06em]">
                <span data-hero-line className="block">
                  coding{" "}
                  <span className="relative inline-block" style={{ color: ACCENT }}>
                    agents.
                    <span
                      data-hero-underline
                      aria-hidden
                      className="absolute -bottom-1 left-0 h-[3px] w-full rounded-full"
                      style={{ background: ACCENT, boxShadow: `0 0 16px ${ACCENT}` }}
                    />
                  </span>
                </span>
              </span>
            </h1>

            <p data-hero-fade className="mx-auto mt-7 max-w-2xl text-pretty text-base leading-relaxed text-white/65 sm:text-lg">
              {SITE.oneLiner}
            </p>

            <div data-hero-fade className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <a
                href={SITE.releases}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold text-[#0a0b0d] transition hover:brightness-95",
                  focusRing,
                )}
                style={{ background: ACCENT, boxShadow: `0 18px 50px -24px ${ACCENT}` }}
              >
                <Download className="size-[18px]" /> Download for desktop
              </a>
              <a
                href={SITE.repo}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-6 py-3 text-[15px] font-medium text-white transition hover:border-white/30 hover:bg-white/[0.06]",
                  focusRing,
                )}
              >
                <Github className="size-[18px]" /> View source <ArrowRight className="size-4" />
              </a>
            </div>

            <div data-hero-fade className="mt-5 flex justify-center">
              <Copyable text={SITE.npx} />
            </div>

            {/* the five agents */}
            <div data-hero-fade className="mx-auto mt-12 flex max-w-2xl flex-wrap items-center justify-center gap-x-8 gap-y-4">
              {PROVIDERS.map((p) => (
                <span
                  key={p.id}
                  className="group/v inline-flex items-center gap-2 text-white/55 transition hover:text-white"
                  title={`${p.name} — ${p.vendor}`}
                >
                  <BrandIcon
                    name={p.brand as BrandKey}
                    className="size-5 opacity-70 transition group-hover/v:opacity-100"
                    style={{ color: p.accent }}
                  />
                  <span className="text-[15px] font-medium">{p.name}</span>
                </span>
              ))}
            </div>
          </div>

          {/* hero screenshot */}
          <div ref={heroShotRef} className="relative mx-auto mt-16 max-w-5xl will-change-transform">
            <ScreenshotFrame
              src="/shots/home.png"
              alt="The Ryco workspace — project sidebar, an agent thread and the source-control panel side by side."
              title="ryco — feat/add-new-marketing-site"
              loading="eager"
              className="shadow-[0_50px_140px_-40px_rgba(0,0,0,0.85)] ring-1 ring-white/10"
            />
          </div>
        </section>

        {/* ------------------------------- marquee ------------------------------- */}
        <section aria-hidden className="relative border-y border-white/10 py-5">
          <div className="flex overflow-hidden">
            <div data-marquee className="flex w-max shrink-0 items-center gap-8 pr-8">
              {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
                <span key={i} className="flex items-center gap-8 font-['Space_Grotesk'] text-2xl font-medium text-white/30 sm:text-3xl">
                  {item}
                  <span style={{ color: ACCENT }}>/</span>
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------- agents -------------------------------- */}
        <section id="agents" className={cn("relative", NAV_OFFSET)}>
          <div className="mx-auto max-w-7xl px-5 pt-24 sm:px-8">
            <div data-reveal className="max-w-2xl">
              <Eyebrow>Five agents · one workspace</Eyebrow>
              <SectionHeading className="mt-5">Every coding agent, side by side.</SectionHeading>
              <p className="mt-5 text-white/60 sm:text-lg">
                Codex, Claude, GitHub Copilot, OpenCode and Cursor — each through its native SDK or
                protocol, using the subscription you already pay for. Switch per thread without losing
                context.
              </p>
            </div>
          </div>

          {reduced ? (
            /* Static fallback — a clean responsive grid, all agents visible. */
            <div className="mx-auto max-w-7xl px-5 pt-12 sm:px-8">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {PROVIDERS.map((p, i) => (
                  <ProviderCard key={p.id} p={p} index={i} />
                ))}
              </div>
              <div className="mt-5">
                <ScreenshotFrame
                  src="/shots/providers.png"
                  alt="Ryco settings showing all five providers authenticated with live version and subscription status."
                  title="Settings — Providers"
                  className="ring-1 ring-white/10"
                />
              </div>
            </div>
          ) : (
            /* Motion — pinned horizontal gallery that scrolls sideways. */
            <div ref={hzPinRef} className="relative mt-12 flex h-[100svh] items-center overflow-hidden">
              <div ref={hzTrackRef} className="flex w-max items-stretch gap-6 px-5 will-change-transform sm:gap-8 sm:px-8">
                {/* intro panel */}
                <div className="flex w-[82vw] shrink-0 flex-col justify-center sm:w-[58vw] lg:w-[34vw] lg:max-w-[460px]">
                  <Eyebrow>The line-up</Eyebrow>
                  <p className="mt-5 font-['Space_Grotesk'] text-3xl font-bold leading-tight tracking-[-0.02em] sm:text-4xl">
                    Scroll across the five.
                  </p>
                  <p className="mt-4 text-white/55">
                    Authenticate once on the command line, then run them all from one surface — with
                    full visibility into what each one does.
                  </p>
                  <p className="mt-6 inline-flex items-center gap-2 font-['JetBrains_Mono'] text-xs uppercase tracking-widest" style={{ color: ACCENT }}>
                    Scroll <MoveRight className="size-4" />
                  </p>
                </div>

                {PROVIDERS.map((p, i) => (
                  <div key={p.id} className="w-[82vw] shrink-0 sm:w-[58vw] lg:w-[40vw] lg:max-w-[540px]">
                    <ProviderCard p={p} index={i} />
                  </div>
                ))}

                {/* real screenshot finale */}
                <div className="flex w-[88vw] shrink-0 items-center sm:w-[70vw] lg:w-[58vw] lg:max-w-[860px]">
                  <div className="w-full">
                    <ScreenshotFrame
                      src="/shots/providers.png"
                      alt="Ryco settings showing all five providers authenticated with live version and subscription status."
                      title="Settings — Providers"
                      className="ring-1 ring-white/10"
                    />
                    <p className="mt-4 text-sm text-white/50">All five, authenticated and live.</p>
                  </div>
                </div>
              </div>
              {/* horizontal-scroll progress */}
              <div aria-hidden className="pointer-events-none absolute inset-x-5 bottom-6 sm:inset-x-8">
                <div className="h-px w-full overflow-hidden bg-white/10">
                  <div data-hz-progress className="h-px w-full origin-left scale-x-0" style={{ background: ACCENT }} />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* -------------------------- model providers ---------------------------- */}
        <section className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-center">
            <div data-reveal>
              <Eyebrow>Model providers & routing</Eyebrow>
              <SectionHeading className="mt-5">Same agent, your choice of backend.</SectionHeading>
              <p className="mt-5 max-w-md text-white/60">
                Named provider instances let you run, say,{" "}
                <span className="font-['JetBrains_Mono']" style={{ color: ACCENT }}>claude_openrouter</span>{" "}
                and{" "}
                <span className="font-['JetBrains_Mono']" style={{ color: ACCENT }}>codex_personal</span>{" "}
                at once — each with independent config, env vars, auth identity, models and accent colour.
              </p>
            </div>

            <div data-reveal className="rounded-3xl border border-white/10 bg-white/[0.02] p-7 sm:p-8">
              <p className="font-['JetBrains_Mono'] text-[11px] uppercase tracking-[0.2em] text-white/55">
                Model providers
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {MODEL_PROVIDERS.map((m) => (
                  <span
                    key={m}
                    className="rounded-lg border border-white/12 bg-white/[0.04] px-3 py-1.5 font-['JetBrains_Mono'] text-[13px] text-white/80"
                  >
                    {m}
                  </span>
                ))}
              </div>
              <p className="mt-7 font-['JetBrains_Mono'] text-[11px] uppercase tracking-[0.2em] text-white/55">
                Named instances
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {INSTANCE_EXAMPLES.map((n) => (
                  <span
                    key={n}
                    className="rounded-lg border px-3 py-1.5 font-['JetBrains_Mono'] text-[13px]"
                    style={{ color: ACCENT, borderColor: `${ACCENT}33`, background: `${ACCENT}0f` }}
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------- showcase ------------------------------ */}
        <section id="showcase" className={cn("relative mx-auto max-w-7xl px-5 py-24 sm:px-8", NAV_OFFSET)}>
          <div data-reveal className="max-w-2xl">
            <Eyebrow>The workspace</Eyebrow>
            <SectionHeading className="mt-5">Built for the way you actually ship.</SectionHeading>
            <p className="mt-5 text-white/60 sm:text-lg">
              Not a chat box bolted onto a terminal — a real workspace. Worktrees, models, diffs,
              terminals and your editor, a keystroke apart.
            </p>
          </div>

          {reduced ? (
            /* Static fallback — every step stacked with its screenshot, fully visible. */
            <div className="mt-16 space-y-20">
              {SHOWCASE.map((s, i) => (
                <div key={s.shot} className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                  <div className={cn(i % 2 === 1 && "lg:order-2")}>
                    <Eyebrow>{s.eyebrow}</Eyebrow>
                    <h3 className="mt-4 font-['Space_Grotesk'] text-2xl font-semibold tracking-[-0.01em] sm:text-3xl">
                      {s.heading}
                    </h3>
                    <p className="mt-4 max-w-md text-white/60">{s.body}</p>
                    <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/65">
                      {s.points.map((pt) => (
                        <li key={pt} className="inline-flex items-center gap-1.5">
                          <Check className="size-3.5" style={{ color: ACCENT }} /> {pt}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className={cn(i % 2 === 1 && "lg:order-1")}>
                    <ScreenshotFrame src={s.shot} alt={s.alt} title={s.title} className="ring-1 ring-white/10" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Motion — sticky screenshot that swaps as the copy scrolls by. */
            <div className="mt-16 grid gap-12 lg:grid-cols-2 lg:gap-16">
              <div className="hidden lg:block">
                <div className="sticky top-[14vh]">
                  <div className="relative">
                    {/* invisible sizer keeps the stack height stable */}
                    <div className="invisible" aria-hidden>
                      <ScreenshotFrame src={SHOWCASE[0].shot} alt="" title={SHOWCASE[0].title} />
                    </div>
                    {SHOWCASE.map((s, i) => (
                      <div
                        key={s.shot}
                        aria-hidden={i !== activeShot}
                        className={cn(
                          "absolute inset-0 transition-all duration-700 ease-out",
                          i === activeShot
                            ? "scale-100 opacity-100 blur-0"
                            : "pointer-events-none scale-[0.97] opacity-0 blur-[2px]",
                        )}
                      >
                        <ScreenshotFrame
                          src={s.shot}
                          alt={s.alt}
                          title={s.title}
                          loading="eager"
                          className="ring-1 ring-white/10"
                        />
                      </div>
                    ))}
                    {/* step counter */}
                    <div className="pointer-events-none absolute -top-7 right-0 font-['JetBrains_Mono'] text-xs tabular-nums text-white/35">
                      <span style={{ color: ACCENT }}>{String(activeShot + 1).padStart(2, "0")}</span>
                      <span> / {String(SHOWCASE.length).padStart(2, "0")}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                {SHOWCASE.map((s, i) => (
                  <div
                    key={s.shot}
                    data-shot-step
                    className={cn(
                      "flex min-h-[78vh] flex-col justify-center border-l-2 pl-6 transition-all duration-500 lg:min-h-[80vh]",
                      i === activeShot ? "opacity-100" : "lg:opacity-40",
                    )}
                    style={{ borderColor: i === activeShot ? ACCENT : "rgba(255,255,255,0.1)" }}
                  >
                    <Eyebrow>{s.eyebrow}</Eyebrow>
                    <h3 className="mt-4 font-['Space_Grotesk'] text-3xl font-semibold tracking-[-0.015em] sm:text-4xl">
                      {s.heading}
                    </h3>
                    <p className="mt-5 max-w-md text-white/60 sm:text-lg">{s.body}</p>
                    <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/65">
                      {s.points.map((pt) => (
                        <li key={pt} className="inline-flex items-center gap-1.5">
                          <Check className="size-3.5" style={{ color: ACCENT }} /> {pt}
                        </li>
                      ))}
                    </ul>

                    {/* on small screens the screenshot rides inline with the copy */}
                    <div className="mt-7 lg:hidden">
                      <ScreenshotFrame src={s.shot} alt={s.alt} title={s.title} className="ring-1 ring-white/10" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ------------------------------- features ------------------------------ */}
        <section id="features" className={cn("relative mx-auto max-w-7xl px-5 py-24 sm:px-8", NAV_OFFSET)}>
          <div data-reveal className="max-w-2xl">
            <Eyebrow>The toolkit</Eyebrow>
            <SectionHeading className="mt-5">Everything wired into one local surface.</SectionHeading>
            <p className="mt-5 text-white/60 sm:text-lg">
              Worktrees, terminals, diffs, MCP, source control and observability — no cloud round-trips
              you didn't ask for.
            </p>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const Icon = ICONS[f.icon];
              return (
                <article
                  key={f.id}
                  data-reveal
                  className="group relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition-colors duration-300 hover:border-white/20"
                >
                  <span className="grid size-11 place-items-center rounded-xl border border-white/12 bg-white/[0.03] text-white/80 transition-colors group-hover:text-[#c6ff3a]">
                    {Icon ? <Icon className="size-5" /> : null}
                  </span>
                  <h3 className="font-['Space_Grotesk'] text-lg font-semibold text-white">{f.title}</h3>
                  <p className="text-[14px] leading-relaxed text-white/55">{f.blurb}</p>
                </article>
              );
            })}
          </div>
        </section>

        {/* --------------------------- pillars + stats --------------------------- */}
        <section className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8">
          <div className="grid gap-5 lg:grid-cols-3">
            {PILLARS.map((pillar) => {
              const Icon = ICONS[pillar.icon];
              return (
                <article
                  key={pillar.title}
                  data-reveal
                  className="rounded-3xl border border-white/10 bg-white/[0.02] p-7 sm:p-8"
                >
                  <span
                    className="grid size-12 place-items-center rounded-2xl border"
                    style={{ color: ACCENT, borderColor: `${ACCENT}33`, background: `${ACCENT}10` }}
                  >
                    {Icon ? <Icon className="size-6" /> : null}
                  </span>
                  <h3 className="mt-5 font-['Space_Grotesk'] text-xl font-semibold text-white">{pillar.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/60">{pillar.body}</p>
                </article>
              );
            })}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {STATS.map((s) => (
              <Stat key={s.label} value={s.value} label={s.label} />
            ))}
          </div>
        </section>

        {/* ----------------------------- how it works ---------------------------- */}
        <section className="relative mx-auto max-w-5xl px-5 py-24 sm:px-8">
          <div data-reveal className="max-w-2xl">
            <Eyebrow>From zero to shipped</Eyebrow>
            <SectionHeading className="mt-5">How it works.</SectionHeading>
          </div>

          <ol data-timeline className="relative mt-14 space-y-10 pl-10">
            {/* base rail + drawn progress */}
            <span aria-hidden className="absolute left-[14px] top-2 bottom-2 w-px bg-white/10" />
            <span
              aria-hidden
              data-timeline-progress
              className="absolute left-[14px] top-2 bottom-2 w-px"
              style={{ background: ACCENT, transformOrigin: "top" }}
            />
            {STEPS.map((step) => (
              <li key={step.n} data-reveal className="relative">
                <span
                  className="absolute -left-10 grid size-7 place-items-center rounded-full border bg-[#0a0b0d] font-['JetBrains_Mono'] text-[11px] font-semibold"
                  style={{ color: ACCENT, borderColor: `${ACCENT}55` }}
                >
                  {step.n}
                </span>
                <h3 className="font-['Space_Grotesk'] text-xl font-semibold text-white">{step.title}</h3>
                <p className="mt-2 max-w-xl text-white/60">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ------------------------------- download ------------------------------ */}
        <section id="download" className={cn("relative mx-auto max-w-7xl px-5 py-24 sm:px-8", NAV_OFFSET)}>
          <div data-reveal className="max-w-2xl">
            <Eyebrow>Cross-platform · {SITE.license} licensed</Eyebrow>
            <SectionHeading className="mt-5">Download Ryco.</SectionHeading>
            <p className="mt-5 text-white/60 sm:text-lg">
              Native builds for every desktop, or kick the tires instantly with the{" "}
              <span className="font-['JetBrains_Mono'] text-white/80">{SITE.npx}</span> web CLI. Local-first,
              no cloud required.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {PLATFORMS.map((pl) => (
              <a
                key={pl.id}
                href={SITE.releases}
                target="_blank"
                rel="noreferrer"
                data-reveal
                className={cn(
                  "group flex flex-col gap-5 rounded-3xl border border-white/10 bg-white/[0.02] p-7 transition-all duration-300 hover:-translate-y-1 hover:border-white/25",
                  focusRing,
                )}
              >
                <div className="flex items-center gap-4">
                  <span className="grid size-12 place-items-center rounded-2xl border border-white/12 bg-white/[0.03] text-white">
                    <BrandIcon name={pl.brand as BrandKey} className="size-6" />
                  </span>
                  <div>
                    <h3 className="font-['Space_Grotesk'] text-lg font-semibold text-white">{pl.name}</h3>
                    <p className="font-['JetBrains_Mono'] text-xs text-white/55">
                      {pl.format} · {pl.arch}
                    </p>
                  </div>
                </div>
                <p className="text-[14px] leading-relaxed text-white/55">{pl.install}</p>
                <span
                  className="mt-auto inline-flex items-center gap-2 text-sm font-semibold transition-colors group-hover:text-[#c6ff3a]"
                  style={{ color: ACCENT }}
                >
                  <Download className="size-4" /> Get the {pl.format}
                  <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </a>
            ))}
          </div>

          <div data-reveal className="mt-5 overflow-hidden rounded-3xl border border-white/10 bg-black/40 font-['JetBrains_Mono'] text-[13px]">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5 text-white/55">
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="ml-2">zsh</span>
            </div>
            <pre className="overflow-x-auto px-5 py-5 leading-relaxed text-white/85">
              <code>
                <span className="text-white/50"># try it instantly</span>{"\n"}
                <span style={{ color: ACCENT }}>$</span> {SITE.npx}{"\n\n"}
                <span className="text-white/50"># or build from source</span>{"\n"}
                <span style={{ color: ACCENT }}>$</span> git clone {SITE.repo.replace("https://", "")}{"\n"}
                <span style={{ color: ACCENT }}>$</span> bun install{"\n"}
                <span style={{ color: ACCENT }}>$</span> bun run dev:desktop
              </code>
            </pre>
          </div>
        </section>

        {/* --------------------------------- faq --------------------------------- */}
        <section id="faq" className={cn("relative mx-auto max-w-3xl px-5 py-24 sm:px-8", NAV_OFFSET)}>
          <div data-reveal className="mb-10">
            <Eyebrow>Questions</Eyebrow>
            <SectionHeading className="mt-5">Frequently asked.</SectionHeading>
          </div>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <div key={item.q} data-reveal>
                <FaqRow
                  q={item.q}
                  a={item.a}
                  open={openFaq === i}
                  onToggle={() => setOpenFaq(openFaq === i ? null : i)}
                />
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------- final CTA ----------------------------- */}
        <section className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8">
          <div
            data-reveal
            className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.02] px-6 py-16 text-center sm:px-12 sm:py-20"
          >
            <div
              aria-hidden
              className="absolute -top-1/3 left-1/2 size-[60vw] max-w-[640px] -translate-x-1/2 rounded-full blur-[130px]"
              style={{ background: `${ACCENT}1a` }}
            />
            <h2 className="relative mx-auto max-w-3xl font-['Space_Grotesk'] text-[clamp(2rem,5vw,3.6rem)] font-bold leading-[1.02] tracking-[-0.025em]">
              Stop tab-switching.{" "}
              <span style={{ color: ACCENT }}>Start shipping</span> — with every agent at once.
            </h2>
            <p className="relative mx-auto mt-5 max-w-xl text-white/60">
              Local-first, {SITE.license}, and honest about being early. Install a provider, open a
              worktree, and let the agents loose.
            </p>
            <div className="relative mt-9 flex flex-wrap items-center justify-center gap-3">
              <a
                href={SITE.releases}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold text-[#0a0b0d] transition hover:brightness-95",
                  focusRing,
                )}
                style={{ background: ACCENT }}
              >
                <Download className="size-[18px]" /> Download Ryco
              </a>
              <a
                href={SITE.discord}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border border-white/15 px-6 py-3 text-[15px] font-medium text-white transition hover:border-white/30 hover:bg-white/[0.05]",
                  focusRing,
                )}
              >
                <MessagesSquare className="size-[18px]" /> Join the Discord
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* --------------------------------- footer ------------------------------- */}
      <footer className="relative border-t border-white/10 pb-36 pt-14">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <div className="flex items-center gap-2.5">
                <RycoMark className="size-7 rounded-md" />
                <RycoWordmark className="h-[18px] text-white" />
              </div>
              <p className="mt-4 text-sm leading-relaxed text-white/55">{SITE.longDescription}</p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-12 gap-y-8 text-sm">
              <div className="flex flex-col gap-3">
                <span className="font-['JetBrains_Mono'] text-xs uppercase tracking-widest text-white/55">
                  Project
                </span>
                <a href={SITE.repo} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1.5 text-white/65 transition hover:text-white", focusRing)}>
                  <Github className="size-4" /> GitHub
                </a>
                <a href={SITE.releases} target="_blank" rel="noreferrer" className="text-white/65 transition hover:text-white">
                  Releases
                </a>
                <a href={SITE.discord} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1.5 text-white/65 transition hover:text-white", focusRing)}>
                  <MessagesSquare className="size-4" /> Discord
                </a>
              </div>
              <div className="flex flex-col gap-3">
                <span className="font-['JetBrains_Mono'] text-xs uppercase tracking-widest text-white/55">
                  Get started
                </span>
                <a href="#download" className="text-white/65 transition hover:text-white">Download</a>
                <a href="#agents" className="text-white/65 transition hover:text-white">Agents</a>
                <a href="#features" className="text-white/65 transition hover:text-white">Features</a>
              </div>
            </nav>
          </div>

          <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {SITE.license} licensed · © {SITE.company}
            </p>
            <p className="flex items-center gap-2">
              <span className="size-1.5 rounded-full" style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }} />
              {SITE.status}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

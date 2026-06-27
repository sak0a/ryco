/**
 * Always-on, concept-driven icons for the v4 toolkit grid — one per grouped
 * feature. Each is a 100×100 line SVG in `currentColor` that animates
 * continuously (no scroll/hover trigger): agent panels pulse in sequence, a
 * worktree branch traces, a terminal caret blinks, a ⌘K selection scans, theme
 * swatches breathe, and infra links flow.
 *
 * Motion is pure CSS (`.ryco-feat*` in `index.css`); the global
 * `prefers-reduced-motion` guard freezes every loop to a clean, fully-drawn
 * static state, because each animation only ever departs from default base
 * values (dashoffset 0, opacity 1, no transform).
 */
import type { CSSProperties, FC } from "react";
import type { FeatureGroup } from "@/data/content";

type IconProps = { className?: string };

const SVG = "ryco-feat overflow-visible [&_*]:[vector-effect:non-scaling-stroke]";
const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const len = (n: number, delay?: string) =>
  ({ "--len": n, ...(delay ? { animationDelay: delay } : {}) }) as CSSProperties;
const delay = (d: string): CSSProperties => ({ animationDelay: d });

/* Every agent, side by side — three panels light up in sequence. */
function AgentsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 100 100" className={`${SVG} ${className ?? ""}`} {...base} aria-hidden>
      {[12, 40, 68].map((x, i) => (
        <g key={x} className="pulse" style={delay(`${i * 0.4}s`)}>
          <rect x={x} y="30" width="20" height="40" rx="4" />
          <circle cx={x + 10} cy="42" r="2.4" fill="currentColor" stroke="none" />
          <line x1={x + 5} y1="54" x2={x + 15} y2="54" />
          <line x1={x + 5} y1="61" x2={x + 12} y2="61" />
        </g>
      ))}
    </svg>
  );
}

/* Worktrees for every branch — a branch graph traces, nodes pulse. */
function WorktreesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 100 100" className={`${SVG} ${className ?? ""}`} {...base} aria-hidden>
      <line data-trace style={len(56)} x1="28" y1="20" x2="28" y2="80" />
      <path data-trace style={len(40, ".3s")} d="M28 40 C28 53 46 49 60 49" />
      <path data-trace style={len(44, ".6s")} d="M28 60 C28 73 46 69 62 69" />
      <circle className="pulse" cx="28" cy="22" r="5" />
      <circle className="pulse" style={delay(".4s")} cx="62" cy="49" r="5" />
      <circle className="pulse" style={delay(".8s")} cx="64" cy="69" r="5" />
    </svg>
  );
}

/* Terminals, diffs & your editor — a prompt with a blinking caret + a typed line. */
function TerminalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 100 100" className={`${SVG} ${className ?? ""}`} {...base} aria-hidden>
      <rect x="14" y="22" width="72" height="56" rx="7" />
      <path d="M26 40 L33 46 L26 52" />
      <rect className="blink" x="40" y="48" width="14" height="5" rx="1.5" fill="currentColor" stroke="none" />
      <line data-trace style={len(40)} x1="26" y1="64" x2="66" y2="64" />
    </svg>
  );
}

/* Everything on ⌘K — a palette whose selection bar scans the results. */
function CommandIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 100 100" className={`${SVG} ${className ?? ""}`} {...base} aria-hidden>
      <rect x="16" y="20" width="68" height="60" rx="8" />
      <line x1="27" y1="34" x2="63" y2="34" />
      <rect className="scan" x="23" y="43" width="54" height="9" rx="3" fill="currentColor" stroke="none" opacity="0.16" />
      <line x1="29" y1="47.5" x2="55" y2="47.5" />
      <line x1="29" y1="59.5" x2="61" y2="59.5" />
      <line x1="29" y1="71.5" x2="49" y2="71.5" />
    </svg>
  );
}

/* Make it yours — overlapping theme swatches breathe in sequence. */
function ThemesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 100 100" className={`${SVG} ${className ?? ""}`} {...base} aria-hidden>
      <circle className="pulse" cx="40" cy="42" r="19" />
      <circle className="pulse" style={delay(".5s")} cx="60" cy="42" r="19" />
      <circle className="pulse" style={delay("1s")} cx="50" cy="60" r="19" fill="currentColor" fillOpacity="0.12" />
    </svg>
  );
}

/* Local-first infrastructure — a hub with flowing links to satellite services. */
function InfraIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 100 100" className={`${SVG} ${className ?? ""}`} {...base} aria-hidden>
      <line className="flow" x1="50" y1="50" x2="22" y2="28" />
      <line className="flow" style={delay(".25s")} x1="50" y1="50" x2="80" y2="30" />
      <line className="flow" style={delay(".5s")} x1="50" y1="50" x2="52" y2="84" />
      <circle className="pulse" cx="22" cy="28" r="5" />
      <circle className="pulse" style={delay(".4s")} cx="80" cy="30" r="5" />
      <circle className="pulse" style={delay(".8s")} cx="52" cy="84" r="5" />
      <circle cx="50" cy="50" r="8" fill="currentColor" fillOpacity="0.14" />
      <circle cx="50" cy="50" r="8" />
    </svg>
  );
}

export const FEATURE_ICONS: Record<FeatureGroup["id"], FC<IconProps>> = {
  agents: AgentsIcon,
  worktrees: WorktreesIcon,
  terminal: TerminalIcon,
  command: CommandIcon,
  themes: ThemesIcon,
  infra: InfraIcon,
};

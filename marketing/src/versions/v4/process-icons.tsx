/**
 * Bespoke, concept-driven step icons for the v4 "How it works" timeline.
 *
 * Each is a 100×100 line SVG in `currentColor` whose motion *illustrates* its
 * step — an install arrow drops into a tray, a launch ring traces around a play
 * head, a worktree branch grows its graph, a ship check draws inside an orbit.
 * All motion is pure CSS (see the `.ryco-proc*` block in `index.css`), so the
 * global `prefers-reduced-motion` guard freezes every loop to a clean, fully
 * drawn static state — nothing is hidden up front.
 */
import type { CSSProperties } from "react";

type IconProps = { className?: string };

const SVG = "ryco-proc overflow-visible [&_*]:[vector-effect:non-scaling-stroke]";

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Allow the `--len` custom property in inline styles. */
const len = (n: number) => ({ "--len": n }) as CSSProperties;

/* 01 — Install a provider: an install arrow drops into a tray. */
export function InstallIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`${SVG} ryco-install ${className ?? ""}`}
      {...base}
      aria-hidden
    >
      <path data-trace style={len(80)} d="M22 64 V76 H78 V64" />
      <g className="arrow">
        <line x1="50" y1="22" x2="50" y2="55" />
        <polyline points="38 43 50 56 62 43" />
      </g>
    </svg>
  );
}

/* 02 — Launch Ryco: a ring traces around a play head that pulses. */
export function LaunchIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`${SVG} ryco-launch ${className ?? ""}`}
      {...base}
      aria-hidden
    >
      <circle data-trace style={len(201)} cx="50" cy="50" r="32" />
      <path className="play" d="M43 37 L67 50 L43 63 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* 03 — Open a workspace: a git-worktree graph grows a branch. */
export function WorktreeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`${SVG} ryco-worktree ${className ?? ""}`}
      {...base}
      aria-hidden
    >
      <line data-trace style={len(56)} x1="30" y1="26" x2="30" y2="78" />
      <path
        data-trace
        style={{ ...len(52), animationDelay: ".4s" }}
        d="M30 50 C30 66 50 61 66 61"
      />
      <circle className="node" cx="30" cy="22" r="6" />
      <circle className="node" style={{ animationDelay: ".5s" }} cx="70" cy="61" r="6" />
      <circle className="node" style={{ animationDelay: "1s" }} cx="30" cy="82" r="6" />
    </svg>
  );
}

/* 04 — Ship it: a check draws inside a slowly orbiting ring. */
export function ShipIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`${SVG} ryco-ship ${className ?? ""}`}
      {...base}
      aria-hidden
    >
      <circle className="orbit" cx="50" cy="50" r="34" strokeDasharray="5 9" />
      <path data-trace style={len(54)} d="M34 51 L46 64 L68 37" />
    </svg>
  );
}

/** Step number ("01".."04") → icon, in the order STEPS appears. */
export const STEP_ICONS = [InstallIcon, LaunchIcon, WorktreeIcon, ShipIcon] as const;

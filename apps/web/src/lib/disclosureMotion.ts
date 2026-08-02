// FILE: disclosureMotion.ts
// Purpose: Shared open/close motion tokens for collapsible UI (transcript tool
//          rows, turn folds, work groups).
// Layer: Web UI motion primitive
// Exports: timing constants + class-name helpers
// Why: Several transcript disclosures reimplemented the same height/opacity
//      timing locally. Centralizing it keeps every expand/collapse consistent
//      and gives callers one place to tune the curve.

import { cn } from "./utils";

export const DISCLOSURE_TRANSITION_MS = 220;
/** Extra grace before unmounting collapsed children, so the close animation finishes. */
export const DISCLOSURE_CLEANUP_BUFFER_MS = 40;

/**
 * Shell that animates height via `grid-template-rows` + fade. Height animation
 * needs no measurement this way, so it works for content of unknown size.
 */
const DISCLOSURE_SHELL_MOTION_CLASS =
  "grid transition-[grid-template-rows,opacity] duration-[220ms] ease-out motion-reduce:transition-none";

const DISCLOSURE_SHELL_OPEN_CLASS = "grid-rows-[1fr] opacity-100";
const DISCLOSURE_SHELL_CLOSED_CLASS = "grid-rows-[0fr] opacity-0";

/** Required inner wrapper so the grid-row collapse measures correctly. */
export const DISCLOSURE_INNER_CLASS = "min-h-0 overflow-hidden";

/** Content drift/fade layered on top of the shell animation. */
const DISCLOSURE_CONTENT_MOTION_CLASS =
  "transition-[opacity,transform] duration-[220ms] ease-out motion-reduce:transition-none";

const DISCLOSURE_CONTENT_OPEN_CLASS = "translate-y-0 opacity-100";
const DISCLOSURE_CONTENT_CLOSED_CLASS = "-translate-y-1 opacity-0 pointer-events-none";

/** Chevron rotation paired with the shell motion. */
const DISCLOSURE_CHEVRON_MOTION_CLASS =
  "size-3.5 shrink-0 transition-transform duration-[220ms] ease-out motion-reduce:transition-none";

export function disclosureShellClassName(open: boolean, className?: string): string {
  return cn(
    DISCLOSURE_SHELL_MOTION_CLASS,
    open ? DISCLOSURE_SHELL_OPEN_CLASS : DISCLOSURE_SHELL_CLOSED_CLASS,
    className,
  );
}

export function disclosureContentClassName(open: boolean, className?: string): string {
  return cn(
    DISCLOSURE_CONTENT_MOTION_CLASS,
    open ? DISCLOSURE_CONTENT_OPEN_CLASS : DISCLOSURE_CONTENT_CLOSED_CLASS,
    className,
  );
}

export function disclosureChevronClassName(open: boolean, className?: string): string {
  return cn(DISCLOSURE_CHEVRON_MOTION_CLASS, open && "rotate-90", className);
}

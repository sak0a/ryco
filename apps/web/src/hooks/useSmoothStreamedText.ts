// FILE: useSmoothStreamedText.ts
// Purpose: Reveal streamed assistant text at a steady, adaptive cadence so tokens appear
//          fluidly instead of in the network clumps that land in the store.
// Layer: Web UI streaming primitive
// Exports: useSmoothStreamedText, revealBoundary
// Why: Provider deltas reach the store in bursts, so rendering each clump verbatim reads
//      as choppy. This hook drains the already-delivered buffer on requestAnimationFrame
//      at a velocity that adapts to the backlog, low-pass-smooths that velocity so there
//      are no jarring speed jumps, and sleeps between bursts once it catches up. It feeds
//      the text ChatMarkdown already throttles, so markdown re-parse stays coalesced:
//      this hook governs *cadence*, not parse cost.

import { useCallback, useEffect, useRef, useState } from "react";

import { useMediaQuery } from "./useMediaQuery";

// Drain the current backlog over this window. Kept above the network flush interval so a
// small backlog cushion always remains and the reveal tracks inflow without running dry.
const DRAIN_WINDOW_SECONDS = 0.16;
// Hard ceiling so a single huge flush (e.g. a pasted code block) reveals fast but bounded
// rather than snapping in all at once.
const MAX_CHARS_PER_SECOND = 2000;
// Low-pass factor: how aggressively the live velocity chases the target velocity each
// frame. Smaller is smoother but laggier; ~0.15 ≈ a ~110ms time constant at 60fps.
const VELOCITY_LERP = 0.15;
// Clamp per-frame delta so returning from a backgrounded tab (rAF paused) does not dump
// the whole backlog in a single frame.
const MAX_FRAME_SECONDS = 0.05;

/**
 * Pulls a reveal position back off the seam of a surrogate pair.
 *
 * Astral characters (emoji, many CJK extensions) occupy two UTF-16 units, and
 * slicing between them renders U+FFFD. The reveal can sit on one position for
 * several frames when the backlog is small, so the broken glyph would be
 * visible rather than instantaneous.
 *
 * This deliberately stops at code points rather than grapheme clusters:
 * splitting a ZWJ sequence briefly shows a valid, complete emoji, whereas
 * segmenting the whole string every frame would be O(n) on a hot path.
 */
export function revealBoundary(text: string, count: number): number {
  if (count <= 0 || count >= text.length) {
    return count;
  }
  const previous = text.charCodeAt(count - 1);
  const isHighSurrogate = previous >= 0xd800 && previous <= 0xdbff;
  return isHighSurrogate ? count - 1 : count;
}

/**
 * Smoothly reveal `text` while `isStreaming` is true.
 *
 * - Returns `text` unchanged when not streaming or under prefers-reduced-motion, so
 *   completed messages and reduced-motion users see the exact text with zero animation.
 * - Snaps to the full text the instant streaming ends (no trailing typewriter once the
 *   agent is done), and whenever the text changes in a non-append way (e.g. a rewrite).
 * - Text already present on mount is shown immediately; only newly-arriving deltas animate.
 */
export function useSmoothStreamedText(text: string, isStreaming: boolean): string {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const animate = isStreaming && !reduceMotion;

  const [revealed, setRevealed] = useState(text);

  // Latest full text, mirrored post-commit so the rAF loop always reads the current value
  // without re-subscribing the animation effect on every delta.
  const targetRef = useRef(text);
  // Revealed character count, accumulated as a float across frames.
  const shownRef = useRef(text.length);
  // Character count last pushed to React state — guards against redundant setState when the
  // floored count has not advanced.
  const emittedRef = useRef(text.length);
  const velocityRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<(now: number) => void>(() => undefined);
  const lastFrameRef = useRef(0);

  const cancelFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const scheduleFrame = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame((now) => {
      rafRef.current = null;
      tickRef.current(now);
    });
  }, []);

  // Installed in an effect rather than during render; the tick reads everything
  // through refs, so a mount-time install stays permanently fresh.
  useEffect(() => {
    tickRef.current = (now: number) => {
      const previous = lastFrameRef.current;
      const dt = previous ? Math.min((now - previous) / 1000, MAX_FRAME_SECONDS) : 0;
      lastFrameRef.current = now;

      const target = targetRef.current;
      const length = target.length;
      if (shownRef.current > length) {
        shownRef.current = length;
      }

      const backlog = length - shownRef.current;
      if (backlog <= 0) {
        // Sleep while caught up; the text-update effect wakes the loop on the next flush.
        velocityRef.current = 0;
        lastFrameRef.current = 0;
        return;
      }

      const targetVelocity = Math.min(MAX_CHARS_PER_SECOND, backlog / DRAIN_WINDOW_SECONDS);
      velocityRef.current += (targetVelocity - velocityRef.current) * VELOCITY_LERP;
      shownRef.current = Math.min(length, shownRef.current + velocityRef.current * dt);

      const nextCount = revealBoundary(target, Math.floor(shownRef.current));
      if (nextCount !== emittedRef.current) {
        emittedRef.current = nextCount;
        setRevealed(nextCount >= length ? target : target.slice(0, nextCount));
      }

      if (length - shownRef.current > 0) {
        scheduleFrame();
      } else {
        velocityRef.current = 0;
        lastFrameRef.current = 0;
      }
    };
  }, [scheduleFrame]);

  useEffect(() => {
    const previousTarget = targetRef.current;
    const isAppendOnly = text.length >= previousTarget.length && text.startsWith(previousTarget);
    targetRef.current = text;

    if (!animate || !isAppendOnly) {
      cancelFrame();
      shownRef.current = text.length;
      emittedRef.current = text.length;
      velocityRef.current = 0;
      lastFrameRef.current = 0;
      setRevealed(text);
      return;
    }

    if (text.length > shownRef.current) {
      scheduleFrame();
    }
  }, [animate, cancelFrame, scheduleFrame, text]);

  useEffect(() => cancelFrame, [cancelFrame]);

  return animate ? revealed : text;
}

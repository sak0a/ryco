# Status Animation Frame Reduction Design

**Date:** 2026-08-05  
**Status:** Approved for implementation

## Purpose

Complete the applicable animation work inspired by T3Code PR #3978 after Ryco's August 2
performance pass. Preserve the existing six-second status cadence and status semantics while
reducing frame production during the short intervals that still change visually.

## Design

### Status pulse and ping

Keep `.animate-status-pulse` and `.animate-status-ping` on the existing six-second infinite
animations. Preserve the current pulse keyframe values at 0%, 6%, 12%, and 18%, followed by the
flat hold through 100%. Apply `steps(6, end)` only to the 0%-6% and 12%-18% opacity ramps.

Preserve the ping's visible 0%-24% expansion and fade followed by its invisible hold through 100%.
Apply `steps(8, end)` only at the start of the visible interval. The animation starts visible when
mounted and ends the cycle invisible at the same scale, so its iteration reset remains intentional
and immediate.

### Pending Thinking shimmer

Layer a dedicated `thinking-status-shimmer` class on the existing `shimmer` utility. The base
utility continues to own typography, gradient, colors, text clipping, RTL direction, and general
semantics. The dedicated class changes only the pending transcript label's animation name and
duration.

The status shimmer moves from 100% to 0% background position during the first 20% of a six-second
cycle using `steps(8, end)`, then holds the final position through 100%. No JavaScript scheduling or
component state is introduced. The existing reduced-motion rule disables the layered animation and
restores readable solid text.

## Boundaries

- Do not change connection lifecycle, status computation, readiness, React state, or timers.
- Do not change the existing file-edit or sidebar status shimmer behavior.
- Do not change stable-status animation semantics.
- Do not restore noise, surface grain, or any full-viewport overlay.

## Verification

- Unit/component coverage confirms active working and connecting indicators retain status animation
  classes while stable states do not.
- Browser coverage confirms the pending Thinking label receives the dedicated class and animation,
  disappears when the working row settles, and resolves to no animation under reduced motion.
- Static CSS coverage confirms the stepped changing intervals, six-second cadence, long flat holds,
  and reduced-motion rules.
- Run the focused web tests, the web build and full browser suite, and the complete repository
  validation required by `AGENTS.md`.

/**
 * The phone tier's bottom-anchored action group.
 *
 * Presentation only — a class string, no state, no store access — so it obeys
 * the same boundary rule as the rest of `components/mobile/`.
 *
 * Every utility is `phone:`-gated, so a desktop or tablet surface keeps the
 * action group exactly where it sits in its card's flow.
 *
 * `sticky bottom-0` pins the group to the bottom of the scrollport whenever
 * the content above it is taller than the viewport, which is the measured
 * defect this closes: at 320x568 the hosted recovery-codes confirmation sat at
 * y=587 against a 568px viewport — entirely below the fold — and the hosted
 * sign-in stack's trailing actions did the same. Add `phone:mt-auto` at a call
 * site whose group is the last child of a growing flex column, so short
 * content also falls to the bottom instead of floating mid-screen.
 *
 * The group carries the bottom safe area itself: `sticky` resolves against the
 * scrollport, not against the scroll container's padding box, so the track's
 * own bottom padding does not keep a pinned control clear of the home
 * indicator.
 *
 * Nothing here animates, so there is no transition for `prefers-reduced-motion`
 * to collapse and no correctness that waits on one.
 */
export const PHONE_ANCHORED_ACTIONS_CLASS_NAME =
  "phone:sticky phone:bottom-0 phone:z-10 phone:bg-background phone:pt-3 phone:pb-[max(0.25rem,env(safe-area-inset-bottom))]";

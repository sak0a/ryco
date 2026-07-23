# Client runtime slice 5a: threads and orchestration state

**Goal:** Move the mobile-MVP state domains into `@ryco/client-runtime` —
`./state/orchestration`, `./state/threads`, `./state/session`, and
`./state/user-input` — keeping zustand per Decision (d), written through the
Slice-3 state-sink adapter. Web behavior byte-for-byte unchanged.

**Design spec:** `docs/superpowers/specs/2026-07-23-client-runtime-extraction-design.md`
(Slice 5, part 5a; Decisions (c)/(d)).

## Execution rules

- Work only on `feat/client-runtime-state-5a`. Behavior-preserving: existing tests
  keep their assertions (specifier updates only); persisted shapes unchanged.
- Moves: `orchestrationRecovery.ts` + `orchestrationEventEffects.ts` (verbatim —
  both are pure) → `./state/orchestration`; `store.ts` reducers/selectors/coalescer +
  `threadDerivation.ts` + `storeSelectors.ts` + the view-model `types.ts` +
  `lib/threadSort.ts` → `./state/threads`; `session-logic.ts` +
  `threadWorkspaceViewModel.ts` → `./state/session`; `pendingUserInput.ts` →
  `./state/user-input`.
- `store.ts`'s peripheral web touchpoints invert through existing contracts:
  the frame scheduler/clock defaults (already injectable via
  `ShellEventCoalescerDeps`) come from the platform `Clock`/`FrameScheduler`;
  the attachment previewUrl resolver and the hosted-mode flag become injected
  inputs supplied by the web wiring; perf hooks go through the `Observability`
  recorder. The zustand facade moves with the store (zustand gains a package
  dependency edge only if required — verify neutrality, note the lockfile
  consequence).
- `historyBootstrap.ts` is deferred (no runtime consumer). UI-only stores
  (threadSelection, workspace tabs, uiState presentation half) stay web-side.
- Singletons single-homed (Decision c). Bound wrappers for every injected
  timer/frame seam. No react/DOM/node in the package (types.ts must shed any
  DOM-typed members — check for File/blob-typed fields and invert them behind
  the attachment abstraction ONLY if trivially separable; if a type is
  load-bearingly DOM-coupled, leave that TYPE web-side and say so rather than
  forcing it — 5b owns the attachment ripple).
- Never `bun test`; use `bun run test`. Pre-installed worktree. Stage nothing;
  `git diff --check`; scripts/lib clean; no AI trailers; no private detail.

## Task 1 — Pure domains first

`./state/orchestration` and `./state/user-input` (verbatim moves + tests),
then `./state/session` (session-logic's only web coupling is `./types` — moves
with `./state/threads`' types or splits cleanly).

## Task 2 — The threads store

`./state/threads`: reducers, selectors, derivation, coalescer, types,
threadSort; web keeps a thin binding re-exporting the store instance and
supplying the injected inputs. The Slice-3 sink adapter keeps writing through
`useStore.getState()` semantics unchanged.

## Task 3 — Validation (agent, offline)

fmt, fmt:check, lint, typecheck, typecheck:effect, `bun run test`, build.
Falsify one reducer behavior and one coalescer scheduling behavior (neuter →
named failing test → restore). Report everything run.

## Task 4 — Gates, evidence, PR (orchestrator)

Full gate set, audit baseline, three consecutive clean browser runs, diff
review, PR.

# Client runtime slice 5b: composer, queue, terminal, and settings state

**Goal:** Complete the state extraction: the attachment abstraction replaces DOM
`File` through the composer → queue → send pipeline, unlocking
`./state/composer`, `./state/message-queue`, `./state/terminal`, and
`./state/settings`. Web behavior and persisted shapes byte-for-byte unchanged.

**Design spec:** `docs/superpowers/specs/2026-07-23-client-runtime-extraction-design.md`
(Slice 5b; Decision (e) — the flat `{ id, mime, size, bytes } | { id, mime, size, uri }`
union defined in the contract surface; Decisions (c)/(d)).

## Execution rules

- Work only on `feat/client-runtime-state-5b`. Behavior-preserving; persisted
  composer shapes and migrations v1–v7 unchanged (their pinning tests must pass
  unmodified); `sessionTabs.selectors`' component-type entanglement stays web-side.
- **The attachment ripple (Decision e), done honestly:** `ComposerAttachment`
  (the flat union) replaces the DOM `File` in the moved state types; the web
  adapter owns `File` ↔ attachment conversion and the blob-preview-URL lifecycle
  (`createObjectURL`/`revokeObjectURL` stay web-side); persistence encodes to
  bytes/dataURL exactly as `composerDraftPersistence` does today. The
  `executeChatSendTurn` pipeline splits: the pure send engine (provider/model
  resolution, dispatch assembly) moves; UI adapters (toasts, ChatComposer
  types, ChatView logic) stay. If a piece is load-bearingly DOM-coupled beyond
  the attachment fields, leave it web-side and report it — do not force it.
- Moves: `composerDraftStore` + `composerDraftPersistence` logic/migrations
  (storage injected via KV; module-scope localStorage/beforeunload bindings
  invert through the platform lifecycle seam), `messageQueue.logic` +
  `messageQueueStore`, `terminalStateStore` transition helpers + event folding
  (+ `terminalActivity`, `lib/terminalStateCleanup`), `clientPersistenceStorage`'s
  token-lifetime/registry policy (`./state/settings`), and the send engine.
  Domain helpers `modelSelection`, `providerInstances`, `providerModels`,
  `composer-logic` (+ mention syntax) move alongside.
- Stays: `proposedPlan`'s download helper, ui-only stores, all component code.
- Known hazards (all bit us before): bound timer/lifecycle wrappers; no
  import-time side effects (composerDraftPersistence's module-scope storage
  binding + beforeunload registration MUST become injected/lazy without
  changing web behavior — the web binding registers at its own module eval);
  singletons single-homed; no DOM types in the package (File/Blob stay behind
  the adapter); persisted-shape stability proven by the existing migration tests.
- Never `bun test`; use `bun run test`. Pre-installed worktree. Stage nothing;
  `git diff --check`; scripts/lib clean; no AI trailers; no private detail.

## Task 1 — The attachment abstraction

Define `ComposerAttachment` (flat union per the contract surface) in the
package; web adapter converts `File` ↔ attachment and owns preview URLs;
thread it through the moved types. Falsify one conversion behavior.

## Task 2 — Composer and queue

`./state/composer` (store + persistence logic + migrations, storage injected)
and `./state/message-queue`. Migration pinning tests pass unmodified.

## Task 3 — Terminal and settings

`./state/terminal` (folding + helpers + injected StateStorage) and
`./state/settings` (token-lifetime/registry policy over KV/SecretKV).

## Task 4 — The send engine

Split `executeChatSendTurn`: pure engine moves; UI adapters stay; behavior
identical (the queue consumes the same snapshot shapes).

## Task 5 — Validation (agent, offline)

fmt, fmt:check, lint, typecheck, typecheck:effect, `bun run test`, build,
`git diff --check`, scripts/lib clean. Falsify: one migration pin, one queue
op, one send-engine resolution behavior. Report everything run.

## Task 6 — Gates, evidence, PR (orchestrator)

Full gate set, audit baseline, three consecutive clean browser runs, diff
review, PR.

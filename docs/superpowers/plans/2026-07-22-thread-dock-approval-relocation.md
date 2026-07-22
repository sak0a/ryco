# Thread dock approval relocation implementation plan

**Goal:** Keep the thread dock in the bottom third when an approval or pending-input panel is open,
by rendering it beneath those panels instead of above the whole composer form.

**Design spec:**
`docs/superpowers/specs/2026-07-21-liquid-glass-phone-experience-design.md`

Closes the defect the step-4 reachability assertions found and pinned. The specification sequences
this with the model and session-policy sheets; it is split into its own change because it edits the
container the first-tap composer focus correction depends on, and that risk deserves an isolated
diff rather than review attention shared with a new sheet surface.

## The defect

`ApprovalCard` and `ComposerPendingUserInputPanel` render inside `ChatComposer` above the prompt
editor, therefore **below** the dock row that `ChatView` renders above the composer form. An open
approval grows the composer upward and carries the dock with it:

| viewport | dock control centre                | two-thirds line |
| -------- | ---------------------------------- | --------------- |
| 390×844  | y ≈ 305                            | 562.7           |
| 320×568  | y ≈ 75 — back in the **top third** | 378.7           |

Pinned by a full-strength `it.fails` assertion in `ChatView.browser.tsx` carrying those numbers.

## Execution rules

- Work only on `fix/thread-dock-approval-position` in the public repository.
- **Do not regress the first-tap composer focus correction.** The collapsed editor must stay mounted
  and laid out — never `display: none` — and focus must still land in the activating task with no JS
  focus call on that path. Its tests must pass **unmodified**.
- Desktop and tablet must not change. The dock is phone-tier only.
- Presentation and placement only. Approval semantics, gating, store logic, and the readiness gate
  are unchanged.
- Never run `bun test`; use `bun run test`.
- Do not add private issue, deployment, account, node, project, URL, or operational details to the
  public repository, tests, commits, logs, or pull request.
- Inspect the complete staged diff and run `git diff --check` before every commit.

## Task 1: Relocate the dock

**Files:** `apps/web/src/components/ChatView.tsx`,
`apps/web/src/components/chat/ChatComposer.tsx`,
`apps/web/src/components/shell/phone/PhoneThreadDock.tsx`.

- [ ] Render `PhoneThreadDock` inside `ChatComposer`, below the approval and pending-input panels and
      above the prompt row, rather than above the whole composer form in `ChatView`.
- [ ] Thread whatever props it needs explicitly. Do not give the dock store, RPC, or lifecycle
      access — it stays presentation-only, props in and callbacks out.
- [ ] Keep it phone-tier gated exactly as today.
- [ ] The dock must not intercept the composer's activating tap, cover the collapsed editor, or
      change the composer's focus or blur handling in any way.

## Task 2: Unpin the assertion

**Files:** `apps/web/src/components/ChatView.browser.tsx`.

- [ ] Remove the `it.fails` annotation and its "known defect" comment block, keeping the assertion at
      **full strength** and its viewport coverage unchanged.
- [ ] The suite must now report these as ordinary passes, with no expected-failure count.

## Task 3: Prove the focus correction survives

**Files:** `apps/web/src/components/ChatView.browser.tsx`.

- [ ] The existing first-tap focus tests must pass **unmodified**. Do not edit, relocate, or relax
      them. If the relocation makes them fail, stop and report rather than adjusting the test.
- [ ] Add coverage that the collapsed composer still focuses on a single tap **with an approval
      open**, since that is the state whose layout changed.

## Validation

- [ ] `bun install --frozen-lockfile`
- [ ] `bun fmt` / `bun run fmt:check` / `bun lint` / `bun typecheck` / `bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build` / `bun run build --filter=@ryco/web`
- [ ] `bun run --cwd apps/web test:browser`
- [ ] `bun audit`, distinguishing a proven pre-existing baseline from a regression.
- [ ] Revert generated `scripts/lib/*.d.ts` drift.

Known pre-existing flake, do not chase: `apps/server/src/server.test.ts > bootstraps a browser
session and authenticates the session endpoint via cookie`, under the parallel monorepo run only.

## Explicitly deferred to physical qualification

- Real software-keyboard behaviour with an approval open, which is the state this change moves.

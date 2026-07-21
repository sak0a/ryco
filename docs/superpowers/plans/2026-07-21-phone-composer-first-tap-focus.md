# Phone composer first-tap focus implementation plan

**Goal:** One tap on the collapsed phone composer focuses the editor and raises the software
keyboard, every turn — by making the collapsed state a CSS presentation of the always-mounted
editor rather than a separate button that swaps the editor in.

**Design spec:**
`docs/superpowers/specs/2026-07-21-liquid-glass-phone-experience-design.md`

This is the first implementation step of that design. It is deliberately sequenced ahead of the
mobile primitives layer because it shares no code with it, and because the defect costs two taps on
every follow-up message.

## Background

Measured on a deployed hosted build at 390×844 under coarse-pointer emulation, one tap on the
collapsed pill:

```
editor while collapsed  : 0×0, offsetParent === null
document.activeElement  : BODY                        (synchronously, same task as the tap)
document.activeElement  : DIV[contenteditable=true]   (one frame later)
```

One cause: `focusAtEnd()` runs inside a `requestAnimationFrame`, so focus lands outside the
user-activation task and iOS Safari does not raise the keyboard. One blocker on the naive fix: the
editor wrapper is `hidden` at the moment of the tap, so hoisting the call into the click handler
would focus nothing.

## Execution rules

- Work only on `fix/phone-composer-first-tap-focus` in the public repository.
- Add the failing regression before changing production behavior, and confirm it fails for the
  focus-timing reason — not for a timeout, a missing mock, or an unrelated assertion.
- Never run `bun test`; use `bun run test`.
- Desktop composer behavior must not change. The collapse-to-pill path is phone-tier only
  (`isComposerCollapsedMobile`, `ChatComposer.tsx:642`).
- Preserve composer submit, draft, queue, approval, and pending-user-input semantics. This change is
  presentation and focus timing only.
- Do not add private issue, deployment, account, node, project, URL, or operational details to the
  public repository, tests, commits, logs, or pull request.
- Inspect the complete staged diff and run `git diff --check` before every commit.

## Task 1: Add the red first-tap focus regression

**Files:**

- Modify: `apps/web/src/components/ChatView.browser.tsx`

A post-`await` read of `document.activeElement` cannot distinguish synchronous focus from
next-frame focus, because the harness already yields across the click. The assertion must observe
ordering, not final state.

- [ ] Register a `focusin` listener that records an ordering token before dispatching the tap.
- [ ] Schedule a `requestAnimationFrame` callback that records the same token immediately before the
      tap.
- [ ] Assert `focusin` on the editor is recorded **before** the animation-frame token — i.e. focus
      arrived in the activation task, with no interleaved frame.
- [ ] Assert the focused node is the composer editor specifically (`data-testid="composer-editor"`),
      not merely a descendant of the composer form.
- [ ] Add a structural assertion that the collapsed editor's computed `display` is never `none`.
      This is what actually locks the fix in; the ordering assertion alone would pass again under a
      future `flushSync` regression that reintroduces `hidden`.
- [ ] Confirm both assertions fail against current `main` for the stated reason.

## Task 2: Make the collapsed state a CSS presentation of the real editor

**Files:**

- Modify: `apps/web/src/components/chat/ComposerPromptShell.tsx`
- Modify: `apps/web/src/components/ComposerPromptEditor.tsx`

- [ ] Remove `isComposerCollapsedMobile && "hidden"` from the shell wrapper
      (`ComposerPromptShell.tsx:156`) so the editor is laid out and focusable while collapsed.
- [ ] Thread the collapsed state into `ComposerPromptEditor` as an explicit prop rather than
      inferring it inside the editor.
- [ ] Apply collapsed presentation on the `ContentEditable` (`ComposerPromptEditor.tsx:1645-1654`):
      single-line height replacing `min-h-17.5`/`max-h-[200px]`, `overflow-hidden`, and ellipsised
      truncation.
- [ ] Keep the chips, footer, and attachment rows conditionally hidden exactly as today. Only the
      editor stops being hidden.
- [ ] Verify the editor keeps its accessible name while collapsed. The collapsed pill was a labeled
      button; `aria-placeholder` (`:1651`) is not an accessible name.

## Task 3: Decide and implement the two collapsed-rendering cases

**Files:**

- Modify: `apps/web/src/components/ComposerPromptEditor.tsx`
- Modify: `apps/web/src/components/chat/ComposerPromptShell.tsx`

Collapsed now renders Lexical content, not a raw string. Two cases the current pill hid:

- [ ] **Inline tokens.** Mentions, skills, and terminal-context nodes render inline in the collapsed
      line. Truncation ellipsises at the line box and must not reflow or re-wrap token nodes.
- [ ] **Placeholder with terminal contexts.** `ComposerPromptEditor.tsx:1657` suppresses the
      placeholder overlay entirely when `terminalContexts.length > 0`, so a permanently visible
      collapsed editor would render nothing at all. Render a bounded context-count placeholder in
      the collapsed state instead. It must contain no file paths, no terminal output, and no
      node-owned content — a count and a noun only.
- [ ] Collapsed placeholder text stays distinct from expanded placeholder text. The expanded strings
      are already prop-driven (`ComposerPromptShell.tsx:273-292`) and can be collapse-aware.

## Task 4: Remove the frame-deferral machinery

**Files:**

- Modify: `apps/web/src/components/chat/ChatComposer.tsx`

Every item here becomes dead once the tap lands on the editor. Removing them is what makes the
defect unrepeatable rather than patched.

- [ ] Remove `expandMobileComposer` (`:1397-1418`).
- [ ] Remove the collapsed prompt-row pill and its send button (`:1830-1848` and the surrounding
      `showCollapsedMobilePromptRow` block), keeping the collapsed send affordance beside the editor.
- [ ] Remove the "Write custom answer" pill (`:1792-1806`) and route the pending-user-input collapsed
      path through the same always-mounted editor.
- [ ] Remove `mobileComposerExpandFrameRef`, `mobileComposerExpandReleaseFrameRef`, and
      `mobileComposerExpandInFlightRef` (`:656-658`) and their cleanup effect (`:1527-1539`).
- [ ] Remove the in-flight guards those refs feed in `scheduleComposerCollapseCheck` (`:1500`,
      `:1508`), keeping the blur watchdog itself intact.
- [ ] Remove the `onPointerDown={(event) => event.preventDefault()}` calls that existed only to keep
      focus off the pills (`:1840`, `:1801`).
- [ ] Re-examine the `onFocusCapture` early return at `:1710-1718`. It skips setting focus state when
      the target is inside `[data-chat-composer-collapsed-controls="true"]`, which contained the
      pending-input pill. Decide explicitly whether the guard is still required once the pills are
      gone, and leave a comment recording the decision.
- [ ] Confirm `showCollapsedMobilePromptRow` (`:710-711`) is either removed or reduced to the
      presentation flag it now is.

## Task 5: Fix the phone-tier editor type size

**Files:**

- Modify: `apps/web/src/components/ComposerPromptEditor.tsx`

- [ ] Replace `sm:text-[14px]` with `not-phone:text-[14px]` on the `ContentEditable` (`:1647`) and on
      the placeholder overlay (`:1658`).
- [ ] Confirm the editor resolves to 16 px across the whole phone tier — including 640–767 px
      portrait and coarse landscape — and remains 14 px on desktop. The tier is not bounded by `sm`
      (`presentationTier.ts:12-13`), which is why `sm:` was wrong.
- [ ] Add a browser assertion that the computed font size is ≥16 px on the phone tier at a
      640–767 px viewport and in coarse landscape.

## Task 6: Tighten the helpers that mask this class of defect

**Files:**

- Modify: `apps/web/src/components/ChatView.browser.tsx`

Both helpers would let the defect pass again. Tightening them will surface failures in tests that
lean on the loose behavior; fix those tests rather than relaxing the helpers.

- [ ] Replace the retry loop in `expandPhoneComposerIfCollapsed()` (`:1614-1633`) with a single
      activation plus an explicit wait for the editor to hold focus. It currently clicks repeatedly
      for up to 8 s, so it tolerates N taps by construction.
- [ ] Narrow `composerHasFocus()` (`:8262-8267`) to assert the editor holds focus, rather than any
      focusable node inside `[data-chat-composer-form="true"]`.
- [ ] Run the full browser suite and repair every test that depended on the loose helpers.

## Task 7: Bring the sibling deferred-focus sites onto the same rule

**Files:**

- Modify: `apps/web/src/components/chat/ChatComposer.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`

Any focus intended to raise the keyboard must run synchronously in the activation task.

- [ ] `ChatComposer.tsx:1153-1155` — focus after a controlled text replacement. This is the command
      and mention menu selection path and the highest-traffic of these sites.
- [ ] `ChatComposer.tsx:1612-1614` — `addTerminalContext`.
- [ ] `ChatComposer.tsx:1640-1642` — `insertTriggerAtCursor`.
- [ ] `ChatView.tsx:1721-1725` — `scheduleComposerFocus`, reached from roughly twelve call sites.
      Audit each: sites reached from a user gesture must focus synchronously; sites reached from an
      asynchronous event legitimately cannot raise the keyboard and should keep their current
      behavior with a comment saying so.
- [ ] If this task materially enlarges the diff, split it into a follow-up PR rather than weakening
      the review of Tasks 1–6.

## Validation

- [ ] `bun install --frozen-lockfile`
- [ ] `bun fmt`
- [ ] `bun run fmt:check`
- [ ] `bun lint`
- [ ] `bun typecheck`
- [ ] `bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] `bun run build --filter=@ryco/web`
- [ ] `bun run --cwd apps/web test:browser`
- [ ] `bun audit`, distinguishing a proven pre-existing advisory baseline from a regression.
- [ ] Review the complete diff for unrelated changes, generated drift, and desktop behavior changes.

## Explicitly deferred to physical qualification

Chromium proves focus **timing**; it cannot prove the keyboard **raises**. The following are not
claimed by this change's automated evidence and are not to be inferred from it:

- Real iOS Safari software-keyboard raise on the first tap, in browser and installed standalone.
- Real `VisualViewport` keyboard geometry and the resulting composer offset.
- Absence of page zoom on focus at the corrected 16 px type size on real iOS.

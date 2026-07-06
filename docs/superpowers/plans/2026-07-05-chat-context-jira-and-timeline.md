# Chat Context: Jira Work Items + Timeline Rendering — Implementation Plan

> **For agentic workers:** Execute task-by-task, in order. Steps use checkbox
> (`- [ ]`) syntax for tracking. Each task ends with a verify step and a
> commit. Default to inline execution.

**Goal:** (1) Jira work items become attachable chat context (`#RYC-231`
direct-attach, Jira picker tab, prompt formatting). (2) Attached
PR/issue/Jira contexts persist on the message as compact snapshot
attachments and render as chips above the user bubble in the timeline.
(3) Fix the latent server bug where `sourceControlContexts` never reach
the provider adapters.

**Architecture:** A new compact `ChatContextAttachment` joins the
`ChatAttachment` union and rides the existing `message.attachments`
persistence (no migration). Full-detail contexts keep flowing at the
command level; the decider copies them onto the
`thread.turn-start-requested` event payload and the
`ProviderCommandReactor` forwards them into the provider send-turn request
(the bug fix). Jira work items get a parallel `workItemContexts` path:
draft-store slice → picker tab / `#` trigger → command field → shared
formatter → adapters.

**Tech Stack:** TypeScript, Effect + Effect Schema, Vitest (Node +
browser), React, Zustand draft store, Bun monorepo.

**Reference spec:** `docs/superpowers/specs/2026-07-05-chat-context-jira-and-timeline-design.md`.

**Pre-merge gate:** `bun fmt && bun lint && bun typecheck && bun run test`.

---

## File Structure (preview)

| Path                                                             | Status | Responsibility                                                                              |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `packages/contracts/src/orchestration.ts`                        | modify | `ChatContextAttachment` + union; `workItemContexts` on turn commands; event payload fields. |
| `packages/contracts/src/provider.ts`                             | modify | `workItemContexts` on `ProviderSendTurnInput` + cap constant.                               |
| `packages/shared/src/workItemContextFormatter.ts`                | create | Jira → Markdown prompt block.                                                               |
| `packages/shared/src/workItemContextFormatter.test.ts`           | create | Formatter unit tests.                                                                       |
| `apps/server/src/orchestration/decider.ts`                       | modify | Copy both context arrays onto `thread.turn-start-requested`.                                |
| `apps/server/src/orchestration/Normalizer.ts`                    | modify | Pass `type: "context"` attachments through untouched.                                       |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | modify | Forward contexts into send-turn request; images-only provider attachments.                  |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts`               | modify | Append work-item block.                                                                     |
| `apps/server/src/provider/Layers/CodexAdapter.ts`                | modify | Append work-item block.                                                                     |
| `apps/server/src/provider/Layers/OpenCodeAdapter.ts`             | modify | Append work-item block.                                                                     |
| `apps/web/src/types.ts`                                          | modify | Web mirror of `ChatContextAttachment`.                                                      |
| `apps/web/src/composerDraftStore.ts`                             | modify | `workItemContexts` slice + mutators.                                                        |
| `apps/web/src/composerDraftStore.test.tsx`                       | modify | Slice tests (add/dedupe/remove/clear).                                                      |
| `apps/web/src/composer-logic.ts`                                 | modify | Jira-key detection on `#` trigger.                                                          |
| `apps/web/src/composer-logic.test.ts`                            | modify | Trigger tests.                                                                              |
| `apps/web/src/components/chat/WorkItemContextChip.tsx`           | create | Composer chip for Jira contexts.                                                            |
| `apps/web/src/components/chat/ComposerAttachmentMenus.tsx`       | modify | Jira results in `#` menu + selection handler.                                               |
| `apps/web/src/components/chat/ContextPickerPopup.tsx`            | modify | Jira tab.                                                                                   |
| `apps/web/src/components/chat/ContextPickerTabs.tsx`             | modify | `TabId` gains `"jira"`.                                                                     |
| `apps/web/src/components/chat/ContextPickerPopup.browser.tsx`    | modify | Jira tab browser flow.                                                                      |
| `apps/web/src/components/chat/ComposerHintRow.logic.ts`          | modify | `#jira` pill opens picker Jira tab.                                                         |
| `apps/web/src/components/chat/ComposerPromptShell.tsx`           | modify | Render work-item chips in the chip row.                                                     |
| `apps/web/src/components/chat/ChatComposer.tsx`                  | modify | Wire work-item contexts (state, handlers, props).                                           |
| `apps/web/src/components/ChatView.logic.ts`                      | modify | `refreshStaleWorkItemContexts`; send-state count includes work items.                       |
| `apps/web/src/components/ChatView.tsx`                           | modify | Pass work-item contexts to send; timeline context dialog state.                             |
| `apps/web/src/hooks/executeChatSendTurn.ts`                      | modify | Snapshot, compact attachments, dispatch `workItemContexts`, clear on ack.                   |
| `apps/web/src/lib/chatContextAttachments.ts`                     | create | Build compact `ChatContextAttachment`s from draft contexts.                                 |
| `apps/web/src/lib/chatContextAttachments.test.ts`                | create | Builder unit tests.                                                                         |
| `apps/web/src/components/chat/TimelineContextChips.tsx`          | create | Read-only chip row above user bubble.                                                       |
| `apps/web/src/components/chat/MessagesTimeline.tsx`              | modify | Partition attachments; render chip row; click → detail dialog.                              |

---

## Phase 0 — Contracts

### Task 1: `ChatContextAttachment` + `workItemContexts` on commands and events

**Files:** modify `packages/contracts/src/orchestration.ts`, `packages/contracts/src/provider.ts`

- [x] **Step 1: Add the context attachment schema** (after `UploadChatImageAttachment`, `orchestration.ts:183`)

```ts
export const ChatContextAttachmentKind = Schema.Literals(["issue", "change-request", "work-item"]);
export type ChatContextAttachmentKind = typeof ChatContextAttachmentKind.Type;

/**
 * Compact display snapshot of an attached PR / issue / work item. Persisted
 * with the message so the timeline can render what the agent received; the
 * full detail rides the command-level context arrays instead.
 */
export const ChatContextAttachment = Schema.Struct({
  type: Schema.Literal("context"),
  id: ChatAttachmentId,
  kind: ChatContextAttachmentKind,
  provider: TrimmedNonEmptyString.check(Schema.isMaxLength(40)),
  reference: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  state: TrimmedNonEmptyString.check(Schema.isMaxLength(60)),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
});
export type ChatContextAttachment = typeof ChatContextAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment, ChatContextAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment, ChatContextAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;
```

(Replace the existing two union declarations at `orchestration.ts:185-188`.)

- [x] **Step 2: Add `workItemContexts` to both turn commands** — in
      `ThreadTurnStartCommand` (line ~676) and `ClientThreadTurnStartCommand`
      (line ~697), directly below `sourceControlContexts`:

```ts
workItemContexts: Schema.optional(Schema.Array(ComposerWorkItemContext)),
```

Import `ComposerWorkItemContext` from `./workItems.ts`. Check for an
import cycle (`workItems.ts` must not import from `orchestration.ts`; it
doesn't today).

- [x] **Step 3: Extend the event payload** — `ThreadTurnStartRequestedPayload`
      (`orchestration.ts:1140-1154`) gains, below `sourceProposedPlan`:

```ts
sourceControlContexts: Schema.optional(Schema.Array(ComposerSourceControlContext)),
workItemContexts: Schema.optional(Schema.Array(ComposerWorkItemContext)),
```

- [x] **Step 4: Provider input** — in `packages/contracts/src/provider.ts`,
      below `PROVIDER_SEND_TURN_MAX_SOURCE_CONTROL_CONTEXTS` (line 29) add
      `export const PROVIDER_SEND_TURN_MAX_WORK_ITEM_CONTEXTS = 10;` and give
      `ProviderSendTurnInput` a `workItemContexts` field mirroring the
      `sourceControlContexts` field's shape/cap. Import `ComposerWorkItemContext`
      from `./workItems.ts`.

- [x] **Step 5: Verify** — `bun typecheck` (expect existing-code fallout only
      where `ChatAttachment` was assumed image-only; fix those sites by
      narrowing on `attachment.type === "image"`; the known ones are handled in
      Tasks 3 and 8).

- [x] **Step 6: Contract tests** — extend the orchestration contract test
      (sibling of existing schema tests): `ChatContextAttachment` round-trip;
      images-only legacy `attachments_json` array still decodes via
      `Schema.Array(ChatAttachment)`; turn command with `workItemContexts`
      decodes.

- [x] **Step 7: Commit** — `feat(contracts): add chat context attachments and work-item contexts`

### Task 2: Web type mirror

**Files:** modify `apps/web/src/types.ts`

- [x] **Step 1:** Below `ChatImageAttachment` (`types.ts:40-49`):

```ts
export interface ChatContextAttachment {
  type: "context";
  id: string;
  kind: "issue" | "change-request" | "work-item";
  provider: string;
  reference: string;
  title: string;
  state: string;
  url: string;
}

export type ChatAttachment = ChatImageAttachment | ChatContextAttachment;
```

- [x] **Step 2:** `bun typecheck` — fix any web narrowing fallout (sites
      assuming `attachments` are images; `MessagesTimeline.tsx:344` is handled
      properly in Task 9 — for now narrow with `.filter((a) => a.type === "image")`).
- [x] **Step 3: Commit** — `feat(web): mirror chat context attachment type`

---

## Phase 1 — Server plumbing + formatter

### Task 3: Fix the context drop; images-only provider attachments

**Files:** modify `apps/server/src/orchestration/decider.ts`,
`apps/server/src/orchestration/Normalizer.ts`,
`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

- [x] **Step 1: Normalizer pass-through** — in `normalizeDispatchCommand`
      (`Normalizer.ts:90-153`), the `Effect.forEach` over
      `command.message.attachments` currently assumes every entry has a
      `dataUrl`. Branch first:

```ts
if (attachment.type === "context") {
  return attachment;
}
```

- [x] **Step 2: Decider copies contexts onto the event** — in the
      `thread.turn.start` case (`decider.ts`, `turnStartRequestedEvent` payload
      at ~515-529), below `sourceProposedPlan`:

```ts
...(command.sourceControlContexts !== undefined && command.sourceControlContexts.length > 0
  ? { sourceControlContexts: command.sourceControlContexts }
  : {}),
...(command.workItemContexts !== undefined && command.workItemContexts.length > 0
  ? { workItemContexts: command.workItemContexts }
  : {}),
```

- [x] **Step 3: Reactor forwards contexts** — in
      `ProviderCommandReactor.ts`:
  - `buildSendTurnRequestForThread` input (line ~528) gains optional
    `sourceControlContexts` / `workItemContexts`; spread them into the
    returned request object (below `customSystemPrompt`).
  - The call site (line ~798) passes
    `event.payload.sourceControlContexts` / `event.payload.workItemContexts`.
  - Everywhere the reactor builds provider `attachments` from
    `message.attachments` (lines ~552, ~612, ~657, ~742, ~801), filter to
    images: `const imageAttachments = (input.attachments ?? []).filter((a) => a.type === "image")`.
    Context attachments must never enter the provider image pipeline or its
    max-8 cap.

- [x] **Step 4: Tests** — extend the decider test (turn.start emits payload
      containing the context arrays) and the reactor test (send-turn request
      contains `sourceControlContexts`/`workItemContexts`; provider attachments
      exclude `type: "context"` entries). This is the regression test for the
      silent-drop bug.

- [x] **Step 5: Verify** — `bun --filter ryco-cli run test` (server package
      tests) and `bun typecheck`.
- [x] **Step 6: Commit** — `fix(server): forward attached contexts to provider send-turn requests`

### Task 4: Work-item prompt formatter + adapter wiring

**Files:** create `packages/shared/src/workItemContextFormatter.ts` (+ test),
modify the three adapters

- [x] **Step 1: Formatter** — mirror
      `sourceControlContextFormatter.ts` (same file layout, same truncation
      note handling):

```ts
export function formatWorkItemContextsForAgent(
  contexts: ReadonlyArray<ComposerWorkItemContext>,
): string;
```

Section shape: `### Work Item RYC-231: <title>`, then `URL:`, `Status:
<stateName>`, optional `Type:` / `Priority:` / `Assignee:` / `Labels:`,
blank line, `description`, `Recent comments:` list (author + timestamp +
body), truncation note when `detail.truncated`. Export from the package
index the same way the source-control formatter is exported.

- [x] **Step 2: Formatter tests** — empty array → `""`; full ticket renders
      every populated field; optional fields omitted; truncation note gated on
      `truncated`.

- [x] **Step 3: Adapters** — at each existing call site
      (`ClaudeAdapter.ts:695-700`, `CodexAdapter.ts:1648`,
      `OpenCodeAdapter.ts:1616`) compose both blocks:

```ts
const sourceControlBlock = formatSourceControlContextsForAgent(input.sourceControlContexts ?? []);
const workItemBlock = formatWorkItemContextsForAgent(input.workItemContexts ?? []);
const contextBlocks = [sourceControlBlock, workItemBlock].filter(Boolean).join("\n\n");
// prepend contextBlocks + "\n\n" to the user text when non-empty (existing pattern)
```

- [x] **Step 4: Verify** — `bun typecheck && bun run test` (shared + server).
- [x] **Step 5: Commit** — `feat(server): format work-item contexts into agent prompts`

---

## Phase 2 — Composer (Jira attach)

### Task 5: Draft-store slice

**Files:** modify `apps/web/src/composerDraftStore.ts` (+ its test)

- [x] **Step 1:** `ComposerThreadDraftState` (line 76-98) gains
      `/** Jira work-item contexts attached to this draft. Not persisted. */`
      `workItemContexts: ComposerWorkItemContext[]`. Update every draft-state
      initializer/reset in the file (search for `sourceControlContexts: []`).
- [x] **Step 2:** Mutators mirroring the source-control trio
      (`composerDraftStore.ts:274-279`): `addWorkItemContext` (dedupe key
      `${provider}:${key.toUpperCase()}`, returns `{ added, reason?: "duplicate" }`),
      `removeWorkItemContext(target, id)`, `clearWorkItemContexts(target)`.
- [x] **Step 3:** Tests in `composerDraftStore.test.tsx`: add, duplicate
      no-op with reason, remove, clear; persistence partial excludes the field
      (mirror the existing `sourceControlContexts` assertions).
- [x] **Step 4:** `bun typecheck`, targeted test run, commit —
      `feat(web): work-item context slice in composer draft store`

### Task 6: `#` trigger detects Jira keys

**Files:** modify `apps/web/src/composer-logic.ts` (+ test)

- [x] **Step 1:** In `detectComposerTrigger` (`composer-logic.ts:308-317`)
      extend the `#` branch:

```ts
if (token.startsWith("#")) {
  const query = token.slice(1);
  return {
    kind: "source-control",
    query,
    rangeStart: tokenStart,
    rangeEnd: cursor,
    directAttach: /^[1-9]\d*$/.test(query),
    directAttachWorkItemKey: /^[A-Za-z][A-Za-z0-9]*-[1-9]\d*$/.test(query)
      ? query.toUpperCase()
      : undefined,
  };
}
```

Add `directAttachWorkItemKey?: string` to the `ComposerTrigger`
source-control variant type. The trigger stays pure — whether a Jira
lookup is actually offered is decided in the menus layer (Task 7) based on
the project's Jira link.

- [x] **Step 2:** Tests: `#RYC-231` → key `RYC-231`; `#ryc-231` uppercased;
      `#42` unchanged (`directAttach: true`, no key); `#RYC-` / `#RYC-0` → no
      key; `#bug` → plain query.
- [x] **Step 3:** Typecheck, test, commit —
      `feat(web): detect jira keys in composer # trigger`

### Task 7: Jira picker tab, menu items, chip, hint pill

**Files:** create `apps/web/src/components/chat/WorkItemContextChip.tsx`;
modify `ComposerAttachmentMenus.tsx`, `ContextPickerPopup.tsx`,
`ContextPickerTabs.tsx`, `ComposerHintRow.logic.ts`,
`ComposerPromptShell.tsx`, `ChatComposer.tsx`,
`ContextPickerPopup.browser.tsx`

Gating rule used everywhere in this task: Jira UI renders only when the
project's Atlassian link has `jiraConnectionId` set and
`jiraProjectKeys.length > 0` (same predicate as
`WorkItemsTab.tsx:114-125`; reuse/extract its helper rather than
duplicating).

- [x] **Step 1: Chip** — `WorkItemContextChip.tsx` mirrors
      `SourceControlContextChip.tsx`: `AtlassianJiraIcon`, `key`, truncated
      title, status badge colored by `statusCategory`, remove ✕, truncated
      badge. Render alongside source-control chips in `ComposerPromptShell.tsx`
      (chip row at lines 177-190) via new props.
- [x] **Step 2: Menu integration** — in `useComposerAttachmentMenus`
      (`ComposerAttachmentMenus.tsx`, `#` branch at ~180-187): when Jira is
      linked, append work-item items from `useWorkItemSearch` results; new
      selection handler `useComposerWorkItemContextSelection` mirroring the
      source-control one (~268-346): fetch `WorkItemDetail` (existing
      `workItems.get` RPC via the `useWorkItems` fetch helpers), build
      `ComposerWorkItemContext` (`staleAfter = fetchedAt + 5 min`, same
      constant as source-control), call `addWorkItemContext`, strip the `#…`
      token (`ChatComposer.tsx:1289-1312` pattern). A trigger with
      `directAttachWorkItemKey` attaches directly without opening the list.
- [x] **Step 3: Picker tab** — `ContextPickerTabs.tsx` `TabId` gains
      `"jira"` (label "Jira", `AtlassianJiraIcon`), rendered only under the
      gating rule. `ContextPickerPopup.tsx` renders the work-item list for the
      tab (reuse `ContextPickerList` row shape: key + title + state badge +
      updated date), search wired to `useWorkItemSearch` with the popup's
      existing debounce; selection goes through the same handler as Step 2.
- [x] **Step 4: Hint pill** — `ComposerHintRow.logic.ts` `JIRA_PILL`
      (lines 33-38): action opens the context picker on the Jira tab instead of
      its current placeholder behavior.
- [x] **Step 5: Wiring** — `ChatComposer.tsx`: draft selector for
      `workItemContexts` (mirror line 385 + 416-420), handlers (mirror
      1197-1202, 1480-1484), pass down to `ComposerPromptShell` and the picker
      (mirror 1888-1889, 1936-1938). `ChatView.logic.ts`
      `deriveComposerSendState` (line ~251-262): count work-item contexts so a
      contexts-only send is enabled.
- [x] **Step 6: Browser test** — extend `ContextPickerPopup.browser.tsx`:
      Jira tab hidden when unlinked, visible when linked; search + select
      attaches a chip; duplicate select toasts. Extend the composer browser
      flow for `#RYC-231` direct attach.
- [x] **Step 7:** Typecheck, test, commit —
      `feat(web): jira work items attachable from composer`

---

## Phase 3 — Send path + timeline

### Task 8: Compact attachments + `workItemContexts` dispatch

**Files:** create `apps/web/src/lib/chatContextAttachments.ts` (+ test);
modify `apps/web/src/hooks/executeChatSendTurn.ts`,
`apps/web/src/components/ChatView.logic.ts`,
`apps/web/src/components/ChatView.tsx`

- [x] **Step 1: Builder** — `chatContextAttachments.ts`:

```ts
export function buildChatContextAttachments(input: {
  sourceControlContexts: ReadonlyArray<ComposerSourceControlContext>;
  workItemContexts: ReadonlyArray<ComposerWorkItemContext>;
}): ChatContextAttachment[];
```

Mapping: source-control → `kind` from ctx.kind, `reference` = `#<number>`
(cross-repo: `owner/repo#<number>` when `detail` carries
`headRepositoryNameWithOwner` differing from the workspace repo — derive
from the existing `reference` string when it contains a slash), `title` =
`detail.title`, `state` = `detail.state` (change requests: `"draft"` when
`isDraft`), `url` = `detail.url`. Work items → `kind: "work-item"`,
`provider: "jira"`, `reference` = key, `state` = `detail.stateName`,
`url` = `detail.url`. `id` = ctx.id (already `ChatAttachmentId`-safe
UUIDs). Unit tests for each mapping incl. draft-PR and cross-repo cases.

- [x] **Step 2: Stale refresh** — `ChatView.logic.ts`: add
      `refreshStaleWorkItemContexts` mirroring
      `refreshStaleSourceControlContexts` (refetch detail when
      `staleAfter < now`, best-effort, fall back to cached).
- [x] **Step 3: Send flow** — `executeChatSendTurn.ts`:
  - Snapshot: `const workItemSnapshot = [...composer.workItemContexts]`
    (line ~329; extend the input type at line 53 and `ChatView.tsx` call
    sites at 2065/2152).
  - After `freshSourceControlContexts` (line ~459), compute
    `freshWorkItemContexts` via the new refresher.
  - Build `const contextAttachments = buildChatContextAttachments(...)`
    from the _fresh_ arrays; append to `optimisticAttachments` (line ~355)
    and to the dispatched `message.attachments` (line ~489,
    `[...turnAttachments, ...contextAttachments]`).
  - Dispatch `...(freshWorkItemContexts.length > 0 ? { workItemContexts: freshWorkItemContexts } : {})`
    (below line ~499).
  - Clear work-item contexts wherever source-control contexts are cleared
    on turn-accepted ack (search `clearSourceControlContexts` call sites).
- [x] **Step 4: Verify + commit** — typecheck, extend the existing
      `executeChatSendTurn` tests for the new fields —
      `feat(web): persist compact context attachments with sent messages`

### Task 9: Timeline chips

**Files:** create `apps/web/src/components/chat/TimelineContextChips.tsx`;
modify `apps/web/src/components/chat/MessagesTimeline.tsx`,
`apps/web/src/components/ChatView.tsx`

- [x] **Step 1: Component** — `TimelineContextChips.tsx`: read-only chip
      row (wrap, right-aligned): provider glyph (reuse the icon mapping from
      `SourceControlContextChip` / `AtlassianJiraIcon`), bold reference,
      truncated title (max ~180px), state badge (reuse
      `stateBadgeVariants.ts` coloring where states match; fall back to
      neutral). Props: `attachments: ChatContextAttachment[]`,
      `onOpen(attachment)`.
- [x] **Step 2: Timeline** — `MessagesTimeline.tsx` user-message branch
      (line ~344): partition `row.message.attachments` into
      `userImages` (`type === "image"`) and `contextAttachments`
      (`type === "context"`). Render `<TimelineContextChips …>` **above** the
      bubble `div` (outside the rounded container, inside the
      `max-w-[80%]` column), matching the approved mockup. Image rendering
      unchanged.
- [x] **Step 3: Click-through** — `onOpen` bubbles via the timeline ctx
      (pattern: `ctx.onImageExpand`) up to `ChatView.tsx`, which opens the
      existing `LinkedWorktreeItemDialog` for the item: parse
      `attachment.kind` + `reference` → issue/PR number or work-item key. When
      the reference isn't resolvable in this workspace (cross-repo), open
      `attachment.url` externally instead.
- [x] **Step 4: Browser test** — timeline renders chips for a message with
      context attachments; images-only messages unchanged; click fires the
      open handler (assert dialog opens with the right item in the ChatView
      harness if practical, else unit-test the parse/dispatch helper).
- [x] **Step 5:** Typecheck, test, commit —
      `feat(web): render attached contexts in chat timeline`

---

## Phase 4 — Gate

### Task 10: Full pre-merge gate + manual smoke

- [x] **Step 1:** `bun fmt && bun lint && bun typecheck && bun run test`
      (clear stale `tsconfig.tsbuildinfo` first if typecheck output looks
      cached; the real bar is zero `error TS` lines).
- [ ] **Step 2:** Manual smoke in the dev app (`bun dev:desktop`; rebuild
      the server bundle first: `bun --filter ryco-cli run build:bundle`):
      attach a GitHub issue + a Jira ticket, send, confirm (a) chips render in
      the timeline, (b) the agent's turn shows it received both contexts
      (check the prompt via provider logs or the agent's own acknowledgement),
      (c) chip click opens live detail.
- [x] **Step 3:** Update the spec if implementation diverged; commit.

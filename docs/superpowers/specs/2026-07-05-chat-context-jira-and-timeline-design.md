# Chat Context: Jira Work Items + Timeline Rendering — Design Spec

## Goal

Two gaps in the chat-context system, one spec:

1. **Jira work items become attachable chat context.** The composer's `#`
   trigger and context picker learn Jira: `#RYC-231` direct-attaches a
   ticket, a Jira tab appears in the picker for linked projects, and the
   attached ticket is formatted into the agent prompt the same way GitHub
   issues and PRs already are.
2. **Attached context becomes visible in the chat timeline.** Today a
   PR/issue attached in the composer shows as a chip above the textarea,
   influences the agent via injected prompt text, then disappears from the
   visible conversation once sent. After this spec, every sent message
   renders its attached contexts as compact chips above the user bubble —
   the attachment visibly "travels" from composer to timeline.

Decisions locked during brainstorming:

- Timeline chips render the **persisted snapshot** (reference, title, state
  at send time) — honest about what the agent received. Clicking a chip
  opens the existing detail dialog with **live** data. No background
  refetch for historical messages.
- Chip visual: **compact chips above the bubble**, same visual language as
  the composer chips (provider glyph + reference + truncated title + state
  badge).

## Non-goals

- Rendering context chips for messages sent before this feature ships
  (no backfill; old rows simply have no context attachments).
- Persisting full issue/PR/ticket bodies on the message. The compact
  snapshot is display-only; full detail keeps flowing at the command level
  exactly as today.
- Reworking how source-control contexts reach the agent (the
  command-level `sourceControlContexts` → prompt-injection path is
  unchanged; Jira work items get a parallel path, not a redesign).
- Editing attached ticket content before sending.
- Work-item providers other than Jira (`WorkItemProviderKind` stays
  `"jira"`; the types are already provider-neutral for later expansion).
- Jira OAuth. Manual API-token connections (existing) are the auth model.

## Current state (verified)

- `ChatAttachment` is a union of exactly one member, `ChatImageAttachment`
  (`packages/contracts/src/orchestration.ts:159-188`). The web mirror
  `ChatMessage.attachments` is therefore images-only
  (`apps/web/src/types.ts:40-60`).
- `ThreadTurnStartCommand` carries `sourceControlContexts` at the command
  root (`orchestration.ts:657-699`); they are formatted into the prompt by
  `packages/shared/src/sourceControlContextFormatter.ts` and prepended in
  all three provider adapters (`ClaudeAdapter.ts:695-700`,
  `CodexAdapter.ts:1648`, `OpenCodeAdapter.ts:1616`). They are **not**
  persisted on the message (`ProjectionThreadMessages.ts` decodes
  `attachments_json` as `Schema.Array(ChatAttachment)`).
- `MessagesTimeline.tsx:344-379` renders only image attachments.
- `ComposerWorkItemContext` already exists
  (`packages/contracts/src/workItems.ts:161-169`) but nothing produces or
  consumes it: no picker tab, no trigger branch, no send-path field, no
  formatter.
- The `#jira` hint pill is scaffolded (`ComposerHintRow.logic.ts:33-38`,
  gated on `hasJiraProvider`) but `detectComposerTrigger`
  (`composer-logic.ts:280-328`) has no Jira branch.
- Jira data layer is complete: `workItems.*` RPC (`rpc.ts:312-320`),
  client hooks (`useWorkItems.ts`), `JiraWorkItemService` (server), and
  per-project links (`AtlassianProjectLink.jiraProjectKeys`).

## Contracts

### `ChatContextAttachment` (new union member)

`packages/contracts/src/orchestration.ts`:

```ts
export const ChatContextAttachmentKind = Schema.Literals([
  "issue",
  "change-request",
  "work-item",
]);

export const ChatContextAttachment = Schema.Struct({
  type: Schema.Literal("context"),
  id: ChatAttachmentId,
  kind: ChatContextAttachmentKind,
  provider: TrimmedNonEmptyString,   // "github" | "gitlab" | … | "jira"
  reference: TrimmedNonEmptyString,  // "#42" | "owner/repo#42" | "RYC-231"
  title: TrimmedNonEmptyString,
  state: TrimmedNonEmptyString,      // display snapshot: "open" | "merged" | "In Progress" | …
  url: TrimmedNonEmptyString,
});

export const ChatAttachment = Schema.Union([
  ChatImageAttachment,
  ChatContextAttachment,
]);
```

- `UploadChatAttachment` gains the same member unchanged (context
  attachments carry no upload payload; no `dataUrl` variant needed).
- Mirror the type in `apps/web/src/types.ts`.
- Backward compatibility: adding a union member keeps existing
  `attachments_json` rows (images-only) decoding. **No migration.**
- Caps: context attachments do not count against
  `PROVIDER_SEND_TURN_MAX_ATTACHMENTS` (images). They are bounded by the
  existing max-source-control-contexts check, extended to cover work-item
  contexts with the same limit.

### `workItemContexts` on the turn command

- `ThreadTurnStartCommand` and `ClientThreadTurnStartCommand`
  (`orchestration.ts`) gain
  `workItemContexts: Schema.optional(Schema.Array(ComposerWorkItemContext))`
  as a sibling of `sourceControlContexts`.
- `ProviderSendTurnInput` (`packages/contracts/src/provider.ts:6-24`) gains
  the same field, with the shared count cap.
- `ComposerWorkItemContext` (`workItems.ts:161-169`) is used as-is:
  `{ id, provider, key, detail: WorkItemDetail, fetchedAt, staleAfter }`.

## Server changes

### Work-item prompt formatter

New `packages/shared/src/workItemContextFormatter.ts`, sibling of
`sourceControlContextFormatter.ts`:

- `formatWorkItemContextsForAgent(contexts)` renders a Markdown block
  `## Attached work-item context` with per-ticket sections: key, title,
  url, status (`stateName`), type, priority, assignee, description, and
  recent comments. Reuses the truncation caps from the source-control
  formatter (8 KB body, last 5 comments, 2 KB per comment).
- All three adapters (`ClaudeAdapter`, `CodexAdapter`, `OpenCodeAdapter`)
  concatenate: `sourceControlBlock + workItemBlock + userText`, each block
  omitted when empty. Same insertion point as today.

### Message persistence

None beyond the union change. `dispatchBootstrapTurnStart` /
`ProjectionThreadMessages` pass `message.attachments` through untouched;
they now may contain `type: "context"` members.

## Web changes

### Composer draft store (`composerDraftStore.ts`)

- `ComposerThreadDraftState` gains `workItemContexts:
  ComposerWorkItemContext[]` (not persisted, matching
  `sourceControlContexts`).
- Mutators `addWorkItemContext` (dedupe by `provider:key`, returns
  `{ added, reason?: "duplicate" }`), `removeWorkItemContext`,
  `clearWorkItemContexts` — mirroring the source-control trio at
  `composerDraftStore.ts:274-279`.

### Trigger + picker

- `detectComposerTrigger` (`composer-logic.ts`): inside the existing `#`
  branch, a query matching `/^[A-Za-z][A-Za-z0-9]*-\d+$/` (Jira key) sets
  `directAttach` for a work item — parallel to the pure-integer `#42`
  path. Only active when the project has a Jira link; otherwise the query
  falls through to normal text filtering.
- `ComposerAttachmentMenus.tsx`: `#` menu includes Jira results (via
  `useWorkItemSearch`) when linked; selection fetches `WorkItemDetail`,
  builds a `ComposerWorkItemContext`, calls `addWorkItemContext`, and
  removes the `#…` token from the prompt (same as source-control items at
  `ChatComposer.tsx:1289-1312`).
- `ContextPickerPopup.tsx`: `TabId` gains `"jira"`. Tab renders only when
  the project has a Jira link (`jiraConnectionId` set and
  `jiraProjectKeys.length > 0`); list/search reuse `useWorkItemList` /
  `useWorkItemSearch` with the popup's existing search-input debounce.
- `ComposerHintRow`: the scaffolded `#jira` pill now opens the picker on
  the Jira tab.

### Chips

- New `WorkItemContextChip.tsx` alongside `SourceControlContextChip.tsx`:
  Jira glyph (`AtlassianJiraIcon`), key, truncated title, status badge
  colored by `statusCategory`, remove ✕. Rendered in the same chip row
  (`ComposerPromptShell.tsx:177-190`).
- If the shared markup is near-identical, extract a common base; do not
  force it if the two stay simple.

### Send path (`executeChatSendTurn.ts`)

- Snapshot `workItemContexts` alongside the existing three snapshots
  (`executeChatSendTurn.ts:327-329`).
- Stale refresh: extend `refreshStaleSourceControlContexts`
  (`ChatView.logic.ts`) with a work-item sibling — any context with
  `staleAfter < now` refetches best-effort before dispatch; on failure the
  cached copy is sent.
- Build compact `ChatContextAttachment`s from both context arrays and
  append them to `message.attachments` (optimistic message **and**
  dispatched command), so the server persists them with the message.
  Reference formatting: same-repo issues/PRs → `#42`, cross-repo →
  `owner/repo#42`, work items → key (`RYC-231`).
- Dispatch gains `workItemContexts` at the command root; both context
  arrays clear from the draft on turn-accepted ack (existing lifecycle).

### Timeline (`MessagesTimeline.tsx`)

- User-message renderer partitions `message.attachments` into images and
  contexts. Context chips render in a wrap row **above** the bubble,
  right-aligned with it, using a read-only variant of the composer chips
  (no ✕, no spinner).
- Click opens the existing `LinkedWorktreeItemDialog` for the item
  (issue/PR number or work-item key → live detail). If the dialog cannot
  resolve the item (e.g. cross-repo reference), fall back to opening
  `attachment.url` externally.

## Behavior

| Situation | Behavior |
| --- | --- |
| `#RYC-231` typed, project linked to Jira | Direct-attach work item; token removed from prompt; chip appears. |
| `#RYC-231` typed, no Jira link | Treated as plain text search in the existing tabs; no Jira behavior. |
| Jira tab, project not linked | Tab hidden entirely (setup lives in the Project Explorer Jira tab, not the picker). |
| Duplicate work-item attach | No-op + "Already attached" toast (matches source-control dedupe). |
| Send with contexts | Compact snapshots persist on the message; full details injected into prompt; draft chips clear on ack. |
| Timeline chip click | Live detail dialog; snapshot on the chip never mutates. |
| Item deleted upstream after send | Chip still renders (snapshot is local); the click-through dialog surfaces the fetch error. |
| Historical messages | No context attachments → no chip row → rendering unchanged. |
| Offline at send | Existing behavior: stale refresh fails silently, cached contexts sent. |

## Edge cases

- **Attachment-count cap**: work-item + source-control contexts share one
  cap (existing max-contexts constant). The picker disables attach and
  shows a hint when the cap is reached.
- **Jira link removed between attach and send**: the attached context is
  self-contained (detail already fetched); send proceeds; only stale
  refresh is skipped.
- **Mixed providers on one message**: chips render in attach order;
  provider glyph disambiguates.
- **Optimistic → confirmed message reconciliation**: context attachments
  are byte-identical in both (client-generated), so no flicker.

## Testing

Vitest, colocated; browser mode for components.

| Area | Coverage |
| --- | --- |
| Contracts | `ChatContextAttachment` decode/encode round-trip; legacy images-only `attachments_json` still decodes; turn command with `workItemContexts`. |
| Formatter | `workItemContextFormatter` truncation caps, empty-array omission, block ordering with source-control block. |
| Draft store | Work-item mutators: add/dedupe/remove/clear-on-send. |
| Trigger | Jira-key regex direct-attach; gating on Jira link; `#42` unaffected. |
| Picker (browser) | Jira tab visibility, search, attach → chip. |
| Send path | Compact attachment built for each kind; snapshot fields correct; both arrays on command; clear on ack. |
| Timeline (browser) | Chips render above bubble for context attachments; images-only messages unchanged; click opens dialog. |

## Pre-merge gate

Per `AGENTS.md`: `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`
must pass.

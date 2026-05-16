# Composer Hint Row (First-Turn Quick References)

## Goal

On a brand-new chat thread, show a single row of one-click "Reference X" pills
above the composer that insert Ryco's existing trigger tokens (`#i`, `#pr`,
`#jira`, `/`) for the user. The row teaches the keyboard shortcuts by doing
them visibly, helps users start a thread with structured context, and
disappears for the rest of the thread once the first turn is sent.

The pills reuse the existing inline picker. Clicking the PR pill is
functionally identical to the user typing `#pr ` manually; the picker code
doesn't have to care whether the trigger came from a keystroke or a click.

## Scope

### In scope

- New component `ComposerHintRow` rendered between `ComposerBannerStack` and
  `ChatComposer` in `apps/web/src/components/ChatView.tsx`.
- Visibility gated on `thread.messages.length === 0` (first turn only). Once a
  message is sent, the row unmounts for the lifetime of the thread.
- Four pills, each conditional:
  - 🐛 **Reference issue** — types `#i ` — shown when
    `hasSourceControlRemote === true`.
  - 🔀 **Reference PR** — types `#pr ` — shown when
    `hasSourceControlRemote === true`.
  - 🎫 **Reference Jira** — types `#jira ` — shown when the Atlassian/Jira
    provider is configured for the workspace. Until the Atlassian provider
    ships, the conditional is always false and the pill is never rendered.
  - `/` **Browse commands** — types `/` — always shown.
- Prefix-routing in the inline picker: queries starting with `i`, `pr`, or
  `jira` (optionally followed by whitespace) scope the picker to that single
  item type. Bare `#` keeps today's mixed behavior. Unknown prefixes fall
  through to mixed search.
- Imperative API on `ChatComposerHandle` so the hint row can insert text at
  cursor and focus the editor without reaching into editor internals.
- Tests for: hint-row visibility conditions, pill conditional rendering,
  prefix-detection helper, picker dispatch with each prefix, and a browser
  test that clicks a pill and asserts the trigger is inserted and the scoped
  picker opens.

### Out of scope

- Implementing the Atlassian/Jira provider itself. That work is covered by
  `docs/superpowers/plans/2026-05-12-atlassian-bitbucket-jira-integration.md`.
  This spec only wires the pill and the prefix path so the integration lights
  it up when it lands.
- User preference to hide the hint row permanently. The row is already
  invisible after the first send; a "Don't show again" toggle can be added
  later if telemetry shows it's annoying.
- Animating the row in or out. The row mounts on a fresh thread and unmounts
  after the first send with no transition — same pattern Ryco uses elsewhere.
- Restoring the hint row when a user clears the composer or deletes the only
  draft message — first-turn means "this thread has sent zero messages,"
  full stop.
- Mobile-specific layouts. The row uses the same `max-w-208 mx-auto` container
  as `ComposerBannerStack` and wraps when narrow.

## User flow

```
┌───────────────────── ChatView (fresh thread) ─────────────────────┐
│                                                                    │
│   (banner stack, only when there are system warnings)              │
│                                                                    │
│   ┌── ComposerHintRow ─────────────────────────────────────────┐  │
│   │  [🐛 Reference issue]  [🔀 Reference PR]  [🎫 Reference Jira] [/ Browse commands] │  │
│   └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│   ┌── ChatComposer ────────────────────────────────────────────┐  │
│   │  Plan, search, build anything…                              │  │
│   │  ────────────────────────────────────────────                │  │
│   │  📎  ⚙️                                                  ↑   │  │
│   └────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘

User clicks [🔀 Reference PR]:

1. ChatComposer focuses, "#pr " is inserted at cursor.
2. detectComposerTrigger returns { kind: "source-control", query: "pr " }.
3. ComposerCommandMenu (existing) opens; dispatch sees "pr " prefix and
   scopes the list to PRs only.
4. User picks a PR; the chip is inserted, "#pr " is consumed.
5. User sends the message. ComposerHintRow unmounts for this thread.
```

## Architecture

```
+----------------------+
| ChatView             |
|  ├─ BannerStack      |
|  ├─ ComposerHintRow  |  ← new; visible iff thread.messages.length === 0
|  └─ ChatComposer     |
|       (imperative    |
|        insertTrigger |
|        method)       |
+----------------------+
        │
        │ click on a pill
        ▼
+--------------------------+
| composerHandle           |
|  .insertTriggerAtCursor( |
|    "#pr "                |
|  )                       |
+--------------------------+
        │
        ▼
+--------------------------+
| ComposerPromptEditor     |
|  inserts text, sets      |
|  cursor, focuses         |
+--------------------------+
        │
        ▼ keyup
+--------------------------+
| detectComposerTrigger    |
|  → { kind:"source-control"|
|      query: "pr " }      |
+--------------------------+
        │
        ▼
+--------------------------+
| composerSourceControl    |
|   ContextSearch          |
|   .scopeForQuery(query)  |  ← new helper
|   → { scope:"prs",       |
|       search:"" }        |
+--------------------------+
        │
        ▼
+--------------------------+
| ComposerCommandMenu      |
|  renders scoped results  |
+--------------------------+
```

### Why the prefix logic lives in the search layer, not the detector

`detectComposerTrigger` is intentionally generic: it spots `#token` and hands
back the raw query. Moving prefix knowledge into the detector would couple a
low-level parser to product taxonomy (issues vs PRs vs Jira). Keeping it in
`composerSourceControlContextSearch.ts` (which already owns search semantics
for source-control items) means the detector stays simple, today's `#42`
direct-attach behavior keeps working unchanged, and adding new prefixes later
(e.g., `#linear`) is a one-file edit.

## Component contract — `ComposerHintRow`

```ts
interface ComposerHintRowProps {
  readonly visible: boolean;             // gate on thread.messages.length === 0
  readonly hasSourceControlRemote: boolean;
  readonly hasJiraProvider: boolean;     // false until Atlassian provider ships
  readonly onInsertTrigger: (trigger: "#i " | "#pr " | "#jira " | "/") => void;
  readonly className?: string;
}
```

- Returns `null` when `visible === false`, or when no pill would be rendered
  (no SC remote, no Jira, and somehow even `/` is disabled — defense in
  depth; in practice `/` is always available).
- Each pill is an outline-style small `Button` from `~/components/ui/button`
  with a Lucide icon (`Bug`, `GitPullRequest`, `Ticket`, `Slash`) and a
  short label. The implementor should pick the closest existing variant
  rather than introducing a new one.
- `onInsertTrigger` is the only escape hatch; the component is otherwise
  inert and has no state.
- Container: `mx-auto mb-2 flex max-w-208 flex-wrap gap-1.5` — same
  horizontal alignment as `ComposerBannerStack`.

## Imperative composer API

`ChatComposerHandle` already exists and is consumed via `composerRef` in
`ChatView.tsx`. Extend it with:

```ts
interface ChatComposerHandle {
  // ... existing methods
  insertTriggerAtCursor(text: string): void;
}
```

`insertTriggerAtCursor` focuses the editor, inserts `text` at the current
cursor (creating one at end-of-doc if unfocused), and lets the existing
`detectComposerTrigger` flow handle everything downstream. v1 always
inserts — no dedup, no smart "trigger already present" handling. Acceptable
because the row only shows when the composer is on a fresh thread; the
duplicate-trigger case is rare enough to revisit only if it bites.

## Prefix-detection helper

In `apps/web/src/components/chat/composerSourceControlContextSearch.ts`:

```ts
export type SourceControlScope = "issues" | "prs" | "jira" | "mixed";

export interface ScopedSourceControlQuery {
  scope: SourceControlScope;
  search: string;          // query with the prefix stripped
}

export function scopeSourceControlQuery(query: string): ScopedSourceControlQuery;
```

Rules:

| Raw `query` | `scope` | `search` |
|---|---|---|
| `""` | `"mixed"` | `""` |
| `"i"` or `"i …"` | `"issues"` | rest after `i` (trimmed leading whitespace) |
| `"pr"` or `"pr …"` | `"prs"` | rest after `pr` |
| `"jira"` or `"jira …"` | `"jira"` | rest after `jira` |
| anything else | `"mixed"` | unchanged |

The picker reads `scope` to decide which list/tab to render and uses `search`
to filter. When `scope === "jira"` and the Jira provider isn't configured,
the picker shows an empty state with a one-liner explaining Jira isn't set
up; it does **not** fall back to mixed search (that would be confusing).

## Edge cases

- **No source-control remote and no Jira.** Only the `/` pill renders. Row
  still mounts; it's a useful single hint.
- **No pills at all.** Cannot happen with current design (`/` is
  unconditional), but the component returns `null` defensively if asked to.
- **Composer already has text.** Clicking a pill inserts the trigger at the
  current cursor position, the same as typing it. No special handling.
- **User clears their first message after typing it.** The row stays mounted
  because zero messages have been **sent**. Only `messages.length` drives
  visibility.
- **User clicks the same pill twice.** Second click inserts a second copy of
  the trigger token. The picker opens at the most recent token (existing
  behavior). Acceptable noise — they'll see it and delete.
- **Trigger is inserted while a slash menu is already open.** Whichever
  trigger is closest to the cursor wins; this is existing
  `detectComposerTrigger` behavior. Acceptable.
- **`#jira` with no Atlassian provider configured.** The pill is not
  rendered, but a user could still type `#jira ` manually. Picker shows
  empty Jira state explaining the integration isn't set up; bare `#` still
  works as mixed.

## Test plan

- `composerSourceControlContextSearch.test.ts`: parameterized table for
  `scopeSourceControlQuery` covering each prefix, prefix-with-trailing-space,
  prefix-with-trailing-text, ambiguous starts (`#ipad`, `#price`, `#jiraflow`
  must all fall back to `mixed`), empty input.
- `ComposerHintRow.test.tsx`: renders nothing when `visible === false`;
  renders only `/` when both SC flags are false; renders all four when both
  are true; clicking a pill calls `onInsertTrigger` with the right token.
- `ChatComposer.test`: `insertTriggerAtCursor("#pr ")` focuses the editor,
  inserts the text, and `detectComposerTrigger` returns
  `{ kind: "source-control", query: "pr " }`.
- `ChatView` integration: thread with `messages.length === 0` mounts the
  row; first send unmounts it; second new thread mounts it again.
- Browser test: load fresh thread, click "Reference PR", assert composer
  text becomes `#pr `, picker opens with the PRs tab/scope.

## Acceptance criteria

1. Opening a brand-new chat thread shows up to four pills above the
   composer, conditional on the workspace's source-control and Jira
   configuration.
2. Clicking a pill focuses the composer, inserts the corresponding trigger
   token at cursor, and opens the existing inline picker scoped to the
   matching item type.
3. Typing `#i `, `#pr `, or `#jira ` manually produces the same scoped
   picker as clicking the pill.
4. Bare `#` continues to open the mixed picker exactly as it does today
   (visual regression check on the existing context-picker tests).
5. After the first message is sent in a thread, the hint row never reappears
   in that thread.
6. All of `bun fmt`, `bun lint`, `bun run typecheck`, and `bun run test` pass.

## Open questions

None at the time of writing. The Jira pill is intentionally gated on a flag
that today is always `false`; the Atlassian integration design owns the work
to flip it.

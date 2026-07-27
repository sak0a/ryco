# Mobile Threads/tasks — design slices

**Written at `ffb0dd871` (2026-07-27). Re-verified the same day** by a claim-by-claim pass over
the tree, with an adversarial refutation round on every claim marked stale. Six independently
shippable slices that take the Threads/task experience from "works" to "premium". Each slice
states what the user sees, what it touches, and what it is honestly blocked on. Companion to
[the program status](./2026-07-26-mobile-program-status.md); read §1 of that document first —
the no-React-renderer constraint decides the shape of every slice here.

Corrections found by the verification pass are marked **⚠ CORRECTION** inline. They are not
cosmetic: three of them change what a slice costs, and two change what it is allowed to do.

---

## 0. The constraint that shapes all six

`apps/mobile` cannot mount a React Native component in a test (status §1.1). So every slice
below puts its decisions in a **pure `*Model.ts`** and leaves the `.tsx` as layout only. That
is not ceremony: it is the only way any of this gets regression coverage.

**§0 decision — hoist, don't copy.** The original draft left hoist-into-`client-runtime` vs
copy-into-a-mobile-model open. It is now settled in favour of hoisting, because AGENTS.md
("Duplicate logic across multiple files is a code smell") and the verification pass agree:
`deriveTurnFolds` is already React-free and DOM-free and moves with no new dependencies. Where
a module is _not_ portable (`getOverviewSummary`, `prCheckStatus`), the pass says so explicitly
and the slice re-implements or splits it. See §7.

---

## 0.1 Visual audit — what the running app actually looks like

Captured on a booted iPhone 17 Pro (iOS 26.5) against a live Hub relay node, 2026-07-27.
Screenshots in the session scratchpad (`shots/before-*.png`).

| Surface             | What is on screen today                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Home header         | `R` mark · title · glass capsule holding `[search] [+]`                                                       |
| Inbox row           | status dot · title · `node · project · worktree` · `Idle` · relative time. **No PR, no checks, no provider.** |
| Thread context bar  | scope glyph · `MACBOOK PRO M5 VON LAURIN` · `Ready` · `project · branch` · chevron                            |
| Thread timeline     | user bubble (neutral grey, right) and assistant markdown both read well                                       |
| **Thread activity** | **four bare mono lines: `Command run`, `Tool call`, `Tool call`, `Tool call`**                                |
| Thread composer     | paperclip · `Message` · send. **No model, no mode, no access, no tokens.**                                    |
| New Task            | `Model — GPT-5.4 ›` (no provider glyph) and `Ask / Auto edit / **Full access**`                               |
| Model picker        | flat scroll of fat two-line cards, provider as a subtitle _string_. No icons, groups, or search.              |

The activity rows are the single worst thing in the app: four lines of screen space that carry
no command, no file, no duration, no exit status, and cannot be expanded. That is slice 4, and
the audit is why it should not stay last.

The New Task screen defaults to **Full access** and renders it as plain selected white — no
caution treatment at all. That is a safety signal missing from the highest-privilege setting.

---

## 1. `home-ia` — Home chrome (S/M, no data dependencies)

The only want with zero data dependencies, zero new RPCs, and zero shared-package changes.

**Today:** the "R" mark top-left switches to **Nodes** (`HomeScreen.tsx:84-93`). Settings is
reachable only via Home → Nodes → a "Settings" pill (`NodesScreen.tsx:209-216` — the app's
_only_ `navigate("SettingsSheet")` call). "+" sits in the header-right cluster
(`HomeScreen.tsx:105-116`), passing `{ environmentId: currentNodeScope ?? undefined }`.

**After:** the mark always goes to **Inbox**. Header-right becomes `[Search, Settings]`, with
Settings opening `SettingsSheet` directly. New-task moves to a glass FAB bottom-right, above
the home indicator, passing the same node-scope param the header "+" passes today. Nodes stays
reachable from the existing `HomeModeControl` tab, so nothing is orphaned.

- **New pure model:** `features/home/homeChromeModel.ts` — given `(mode, searchVisible)`,
  returns the header-left/right button descriptors and whether the FAB is shown.

**⚠ CORRECTION — the mark is a mode dispatch, not a route.** `HomeScreen.tsx:89` is
`dispatch({ type: "select-mode", mode: "nodes" })`, and `HomeScreen.test.ts:127` asserts
`expect(navigationMock.navigate).not.toHaveBeenCalled()`. "Goes to Inbox" is therefore
`dispatch({ type: "select-mode", mode: "inbox" })`, not `navigation.navigate`.

**⚠ CORRECTION — `SettingsSheet` is not a sheet.** `mvpRouteConfig.ts:105-111` presents it as
`ios: { presentation: "card" }` and `Stack.tsx:315-319` registers it `headerShown: false` around
a nested stack. A header gear pushes a **full-screen card**, not a sheet. Making it feel like a
sheet is a route-config change (`formSheet` + detents) plus updating the two locked assertions
at `mvpRouteConfig.test.ts:106-108` — work this slice currently scopes as zero. **Owner call.**

**⚠ CORRECTION — the dev-menu FAB will collide.** The circular gear at bottom-right in dev
builds is `expo-dev-menu`'s draggable FAB (`DevMenuFABView.swift:94`), on by default
(`DevMenuPreferences.swift:49`). `app.config.ts:180-188` does not set
`EXDevMenuShowFloatingActionButton`. Set it to `false` in `ios.infoPlist`, or every screenshot
review of this slice is ambiguous.

**⚠ CORRECTION — the test cost is four tests, not one.** `HomeScreen.test.ts:7-11` mocks
`react-native` down to `{Pressable, TextInput, View}` and mocks every child module. Keeping the
inset read inside `NewTaskFab.tsx` is necessary but **not sufficient**: the harness calls
`HomeScreen()` directly (`:67`), so any child it renders is evaluated for real. `NewTaskFab`
must be its own module _and_ be added to the `vi.mock` list. Three further assertions hard-code
today's header IA and must be rewritten — preferably against `homeChromeModel.ts`.

**⚠ CORRECTION — `NodesScreen` has two routes.** `ConnectionsRouteScreen.tsx:9-11` returns
`<NodesScreen />`, so the padding bump and any Settings-pill removal also change the
`Connections` deep-link route and `ConnectionsRouteScreen.test.ts:217-224` (not 209-221).

- **List padding:** three identical `contentContainerStyle={{ paddingBottom: 40 }}` values
  (`InboxScreen.tsx:82`, `ProjectsScreen.tsx:133`, `NodesScreen.tsx:193`). `HomeScreen.tsx:150`
  applies no bottom inset, so 40 is the _entire_ current clearance — a 56–64pt FAB plus the
  ~34pt home indicator needs roughly **110–130**, not a small bump.

## 2. `thread-session-policy` — Mode / Access / Tokens (M)

**Today:** an existing thread has _no_ settings controls. `ThreadComposer.tsx:79-146` renders
attach / editor / send only, and `ThreadDetailScreen.tsx:216-231` reads `runtimeMode`,
`interactionMode`, `tokenMode` through to the send call without any way to change them.

**After:** a control rail above the input row, with a "Session policy" pill opening a sheet of
three segmented groups — Mode / Access / Tokens — mirroring web's `PhoneSessionPolicySheet.tsx`.

| Control | Field             | Values (web label)                                                                                                 |
| ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Mode    | `interactionMode` | `default` → **Build**, `plan` → **Plan**, `ask` → **Ask** (read-only)                                              |
| Access  | `runtimeMode`     | `approval-required` → **Supervised**, `auto-accept-edits` → **Auto-accept edits**, `full-access` → **Full access** |
| Tokens  | `tokenMode`       | `off` / `balanced` / `aggressive`                                                                                  |

**⚠ CORRECTION — "Auto-accept edits", not "Auto-accept".** `sessionPolicyPresentation.ts:34-39`
carries both: `label: "Auto-accept edits"` and `triggerLabel: "Auto-accept"`. The sheet renders
`label` (`PhoneSessionPolicySheet.tsx:110/116`); `triggerLabel` appears only on the collapsed
pill (`:200`). Mobile must carry both strings, not pick one.

`full-access` is `CAUTION_RUNTIME_MODE` in web and gets an orange trigger tint — and it is also
`DEFAULT_RUNTIME_MODE` _and_ what mobile hard-defaults new tasks to (`newTaskModel.ts:23`), and
the audit confirms it ships today with no caution styling at all. **The caution treatment has to
land with the control.**

**⚠ CORRECTION — the persistence seam already exists; this slice fills it in.** The plan said
slice 2 builds it. It does not. `client-runtime/.../sendEngine.ts:194-201` already declares
`persistThreadSettingsForNextTurn(...)` and `:223-232` already calls it in the correct ordered
position (after the first-message title update, before `thread.turn.start`). **Mobile passes an
explicit no-op in two places.** The work is the callback body — diff against `serverThread`,
dispatch the set-commands — not the plumbing. This makes slice 2 materially cheaper than sized.

**⚠ CORRECTION — the Mode group is capability-gated.** Web gates the whole interaction-mode
control on a provider capability and gates `ask` separately. A model that returns a fixed
three-group shape is wrong; the slice must resolve the thread's provider and handle Mode
rendering **zero** segments.

**⚠ CORRECTION — the offline outbox silently drops `tokenMode`.** Adding a Tokens control
without extending `QueuedThreadMessage` means any send made while the thread is running or
disconnected replays as `balanced` regardless of what the user picked. That is a persisted-schema
change with a migration story, which this slice does not budget. **Either extend the outbox or
ship Mode/Access now and Tokens separately.**

**⚠ CORRECTION — every web control is mutation-gated.** `disabled` / `disabledReason` are
inputs to the presentation, not an afterthought. The pure model needs `(disabled, reason)` from
the start; retrofitting changes every option descriptor's shape.

**⚠ CORRECTION — this control has two callers.** `NewTaskComposer.tsx:11-18` is a second,
divergent copy of the Access vocabulary. Scope the new presentation table to cover New Task too,
or mobile ships two Access controls with different words for the same values on adjacent screens.

## 3. `thread-model-picker` — model changer + provider icons (L)

**Today:** `ThreadDetailScreen.tsx:210` silently reuses
`currentThread.modelSelection ?? currentProject?.defaultModelSelection` and errors with "No
model is configured for this project." when neither exists. There is no way to see or change
the model of an existing thread. The New Task picker is a flat, unsearchable list of fat cards
with the provider rendered as a subtitle string.

**After:** a provider+model pill on the rail showing the provider glyph and short model name,
opening a native sheet (one group per provider instance, search). A second pill exposes the
selected model's option descriptors — reasoning effort, thinking, and **fast mode**.

**⚠ CORRECTION — `fastMode` is a per-model option, not a provider trait.** There is no
`fastMode` field in `packages/contracts` (`model.ts:57` is only a doc comment). It is a string
`id` on a `BooleanProviderOptionDescriptor` (`model.ts:31-36`) minted per model by three of the
five drivers — `ClaudeProvider.ts:104-110` (gated on `supportsFastMode`) and
`CodexProvider.ts:132-139` (gated on `additionalSpeedTiers` including `"fast"`). So "fast"
appears or disappears **per model**, and the pill must handle its absence.

**⚠ CORRECTION — `ProviderIcon` covers 2 of 5 drivers and is dead code.** `ProviderIcon.tsx:13`
branches on `claudeAgent` and returns the **OpenAI mark for everything else** — so Copilot,
OpenCode and Cursor all render the wrong brand. Nothing in `apps/mobile` imports it, so it has
never rendered: the `useColorScheme()` read at `:10` is unexercised. Budget three ported marks
plus an explicit `codex` branch and a neutral unknown glyph. This is porting work, not reuse.

**⚠ CORRECTION — model persistence rides `thread.meta.update`.** There is no `thread.model.set`
command. Slice 2's seam needs a fourth branch, and it must be wired into the outbox drain too.

**⚠ CORRECTION — locked provider is a correctness requirement, not a nicety.** Web forbids
switching a _started_ thread to a different provider. Mobile has no locked-provider concept, so
reusing `buildModelOptions` unchanged for the thread picker ships a way to break a provider
session. New Task's picker (unstarted) stays unlocked.

**⚠ CORRECTION — "Favorites" has no data source.** It would be a new mobile-local persisted
preference that does **not** sync with desktop favorites. **Owner call: include or drop.**

**⚠ CORRECTION — `serverConfigAtom` is scoped to the active environment and nulls on switch.**
The picker must tolerate a null/lagging config and must not render "no models" as a terminal
error. The pure model takes `ServerConfig | null` explicitly.

- **Prerequisite:** two provider filters disagree. `lib/modelOptions.ts:64-66` drops on
  `!enabled || !installed || auth.status === "unauthenticated"`; web's phone sheet drops on
  `entry.status !== "ready"`. Converging them is **necessary but not sufficient** — web also
  filters and reorders _models_ per instance and mobile does not, so a model hidden on desktop
  still shows on the phone.

## 4. `thread-activity-fold` — "Working…" / "Worked for 12s" (L)

**Today:** every work entry is one line of `font-mono text-xs` rendering only
`entry.entry.label` (`ThreadDetailScreen.tsx:74-80`). `detail`, `command`, `rawCommand`,
`output`, `exitCode`, `itemType`, `requestKind`, `tone`, `completed`, `changedFiles`,
**`turnId`** and **`toolTitle`** are all dropped on the floor. The audit shows the result:
`Command run` / `Tool call` / `Tool call` / `Tool call`.

**After:** consecutive activity in a turn collapses into one header row — a live timer while
running, "Worked for 12s" once settled. Expanding shows tool rows with icon, heading, command
preview, and a tap-to-expand output panel with exit code. Reasoning / tool / info / error
entries become visually distinct.

**⚠ CORRECTION — `turnId` is the grouping key and already exists.** `MessagesTimeline.logic.ts:445-447`
keys folds on `entry.entry.turnId`. The original field list omitted it, which reads as if turn
grouping needs new plumbing. It does not. `toolTitle` is the right source for each row's heading.

**⚠ CORRECTION — `deriveTurnFolds` is hoistable but not exported.** It lives in
`apps/web/src/components/chat/MessagesTimeline.logic.ts`, is fully React-free and DOM-free, and
moves to `packages/client-runtime/src/state/session/` with no new dependencies — but the symbols
are not exported today. Do **not** hoist `deriveMessagesTimelineRows` alongside it. Hoisting
buys mobile web-identical "Worked for 12s" wording, interrupted-turn wording, and fold-id scheme.

**⚠ CORRECTION — the empty-shell guard is already implemented.** The plan's watch-out ("only
emit a fold when its group actually contains rows") is in the web logic already. Hoisting gets
it free; reimplementing will likely get it wrong.

**⚠ CORRECTION — web keeps the RUNNING fold expanded.** The plan says "collapsed by default";
reusing `deriveTurnFolds` verbatim contradicts that. **Decision:** settled folds collapsed,
running fold expanded — collapsing the live one hides the progress that is the main reason to
have the phone open. Scope "collapsed by default" to settled folds.

**⚠ CORRECTION — mobile has no fold store and no row-derivation layer.** `LegendList` consumes
raw `TimelineEntry[]` directly. Both must be built: (a) fold-expansion state keyed by `foldId`,
(b) a `TimelineEntry[] → Row[]` derivation between `buildThreadTimeline` and the list. (b) also
invalidates `keyExtractor={(entry) => entry.id}` (`:325`), since fold rows are not entries.

- **Watch out:** work entries only exist for the **latest turn**
  (`client-runtime/.../session-logic.ts:594`). `activeTurnStartedAt` maps to
  `thread.latestTurn?.startedAt ?? null`.
- **Watch out:** height changes on expand fight `LegendList`'s `maintainScrollAtEnd` /
  `maintainVisibleContentPosition` (`ThreadDetailScreen.tsx:322-333`). Test against a long
  thread, not a three-message one.
- **Watch out:** this slice is the app's heaviest mono-type consumer and will inherit an
  unowned system mono stack. A premium pass wanting a real mono must add the face to
  `app.config.ts` first.

## 5. `worktree-change-request-badge` — PR / issue / work-item (S)

**Still the cheapest real win. Zero new RPCs, zero server work, data already in the mobile store.**

`SidebarWorktreeSummary` carries `prNumber`, `prState`, `prTitle`, `prIsDraft`, `issueNumber`,
`issueState`, `workItemKey`, `workItemState`.

**⚠ CORRECTION — two of the three consumers discard the fields at their output boundary.**
Only `projectsModel.ts:32-35` passes the whole `SidebarWorktreeSummary` through.
`inboxModel.ts:45` takes the summaries as _input_ but its output `InboxThreadRow` (`:23-35`)
does not carry them; `threadHeaderModel.ts:55` narrows to `Pick<…, "title" | "branch">`. So the
slice must widen `InboxThreadRow`, `ThreadHeaderModel` **and** that `Pick`, plus update
`inboxModel.test.ts` and `threadHeaderModel.test.ts`. Real model+test work, still small.

**After:** inbox rows show a `#42` badge tinted by state (open / merged / closed); the thread
context bar shows the same badge; Jira-linked worktrees show their `workItemKey`.

- **Honesty requirement:** `prState` has **no background refresher**, so the badge is
  **last-known state and must be presented as such**. Do not render it as live.
- **⚠ CORRECTION — provider-aware wording needs a source.**
  `resolveChangeRequestPresentation` (`shared/src/sourceControl.ts:88-110`) needs a
  `SourceControlProviderInfo`, and mobile has none, so slice 5 as written renders "PR" on
  GitLab and Bitbucket. Either hard-code "PR" for now or pull the provider from
  `EnvironmentApi.vcs.onStatus` (`contracts/src/git.ts:231`).

## 6. `thread-ci-checks` — the "3/9" summary (L)

**After:** the thread context bar gains a colored glyph plus "3/9", tapping opens per-check
rows; the same compact summary appears on inbox rows with a PR.

**⚠ CORRECTION — the minimum diff is `apps/mobile`-only, ~5 lines.** The plan called this the
one slice that crosses package boundaries. It is not, and the widening it proposed is not what
`apps/web` does. **Path B:** add a `readRpcClient(environmentId)` accessor in
`apps/mobile/src/connection/environmentApi.ts` (after `:29`) and call the check RPCs — which
already exist on the live client (`client-runtime/src/rpc/wsRpcClient.ts:90/94/113/114`) —
directly, exactly as web does. Widening `EnvironmentApi.sourceControl`
(`contracts/src/ipc.ts:436-449`) remains a legitimate _design_ choice for typing, but it is not
a technical requirement. **Path B keeps this slice in a single public PR.**

**⚠ CORRECTION — `getOverviewSummary` is not React-free.** The "3/9" producer cannot be hoisted
or imported; it can only be re-implemented. The tone-per-row half **is** portable:
`apps/web/src/components/overviewPullRequestChecks.logic.ts` is 253 lines with zero React
imports.

**⚠ CORRECTION — `prCheckStatus.ts` bakes Tailwind class strings into its return value.** A
clean hoist requires first splitting it into a token layer (`kind`/`tone`/`icon`/`label`/
`shortLabel`/`description`/`isTerminal`/`isRefreshable`/`failedChecks` — all portable) and a
web-styling layer (`className`/`iconClassName`/`dotClassName`).

**⚠ CORRECTION — the VCS status stream is unbuilt plumbing.** Both slice 5's live upgrade and
slice 6 want it, and mobile has never subscribed: per-worktree cwd, subscribe/unsubscribe on
focus, resubscribe on reconnect. Neither slice budgets it.

---

## 7. What is genuinely blocked, with evidence

1. **Role is per-grant, not fixed.** The plan said "mobile is `operator`". Mobile's role is a
   runtime value — `homeEnvironmentModel.ts:32` declares `"viewer" | "operator" | "owner" | null`
   — and a **viewer** device is denied every `sourceControl.*` RPC by
   `client-runtime/src/relay/transport.ts:38` before the call leaves the phone. The
   never-fake-green rule must therefore also cover **viewer-role denial**, not just
   owner-only discovery.
2. **Provider auth state is unreachable.** `serverDiscoverSourceControl` is `"owner"`
   (`shared/src/rpcAccessPolicy.ts:54`), so a non-owner device **cannot distinguish "gh CLI is
   not authenticated" from "this PR has no checks"**. Never render green or neutral when the
   real answer is unknown.
3. **PR state can be stale indefinitely** (slice 5). Fixing it properly means the VCS status
   subscription above, or a server-side background refresher.
4. **A context-window meter cannot be built as-is.** `deriveLatestContextWindowSnapshot` lives
   at `apps/web/src/lib/contextWindow.ts:28`, not in `client-runtime`.
5. **Real project favicons are impossible.** `components/ProjectFavicon.tsx:28` hard-codes
   `const faviconUrl = null`. Design around the SF folder glyph.
6. **There is no per-thread CI data anywhere.** Checks are keyed by `cwd` + PR number (or
   branch), so an inbox of N threads across M worktrees implies **M lookups** — a battery
   decision, not just a UI one.

## 8. Decisions — resolved and open

**Resolved (defensible from the tree; reversible if the owner disagrees):**

1. **Runtime-mode vocabulary → adopt web's everywhere**, including New Task. Mobile's "Ask"
   collides with interaction-mode "Ask", which is a different control. One presentation table,
   two callers.
2. **Interaction-mode → "Build"** (`interactionModeConfig.default.label`), not the compact
   menu's hard-coded "Chat".
3. **"Fast" → the per-model boolean option descriptor**, shown only when the selected model
   declares it. Not `tokenMode: "aggressive"`, which is a separate control.
4. **Running fold stays expanded; settled folds collapse.**
5. **Hoist, don't copy** — `deriveTurnFolds` moves to `client-runtime`; `getOverviewSummary`
   and `prCheckStatus`'s styling layer cannot move and are re-implemented/split.
6. **Commit to dark.** `lib/appScheme.ts:11-13` hard-returns `"dark"`. The light block is dead
   code containing **two** real bugs — `--color-warning-bg`/`--color-warning-border` carry dark
   rgba values against the light `--color-warning`, and light `--color-success-bg` is an opaque
   `#b7d6cb` where every other `*-bg` token in both variants is an rgba ramp of its own accent.
   Deleting light also prunes **16 tokens declared in both variants and referenced nowhere**.
7. **PR badge is last-known state and is labelled as such.**

**Owner calls — answered 2026-07-27:**

8. **Settings presentation → true iOS sheet.** `SettingsSheet` becomes `formSheet` with detents,
   so the name stops lying. Costs the route-config change plus the two locked assertions at
   `mvpRouteConfig.test.ts:106-108`.
9. **Model-picker Favorites → dropped.** Group by provider instance with search only. No new
   persisted preference and no silent divergence from desktop. Revisit later if missed.
10. **Tokens → deferred.** The rail ships **Model + Access + Mode**. Tokens waits until
    `QueuedThreadMessage` carries `tokenMode`, so the offline queue cannot replay a send as
    `balanced` against the user's choice.
11. **The "Settings" pill inside Nodes → removed** once the header gear exists, per the owner's
    "instead of going through Nodes → Settings". Updates
    `ConnectionsRouteScreen.test.ts:217-224`.

**Build order confirmed:** `home-ia` first.

## 8.1 Shipped so far (PR #246, both commits CI-green)

**`home-ia` — done.** Mark → Inbox (a `select-mode` dispatch, not a route), header-right
`[Search, Settings]`, new task on a glass FAB bottom-right, Settings pill removed from Nodes,
`SettingsSheet` converted to a real `formSheet` + overlay, one shared list-padding constant,
`EXDevMenuShowFloatingActionButton: false`.

**`thread-session-policy` — done, minus Tokens.** Rail pill in the composer opening a sheet with
Mode and Access. `sessionPolicyPresentation.ts` + `sessionPolicyModel.ts` are pure and tested
(17 tests); `NewTaskComposer` now reads the same table and its local `RUNTIME_OPTIONS` is gone.
Caution treatment lands on `full-access` in both places. Five SF Symbols were added to
`ANDROID_ICON_BY_SF_SYMBOL` — an unmapped name renders nothing on Android.

Three things found while building it, worth carrying forward:

1. **Tokens is still deferred and the reason got sharper.** `QueuedThreadMessage` has no
   `tokenMode` and the drain hardcodes `"balanced"`, so the control cannot ship before the
   persisted schema carries the field.
2. **Segment width is ~92pt at three-up.** "Auto-accept edits" truncates, and so does
   "Auto-accept" once a 14pt icon and its gap are in the row. Segments render `shortLabel` with
   no icon; the glyph lives on the pill. Any future three-up control inherits this constraint.
3. **`?? []` on an atom-derived array defeats every downstream `useMemo`.** It recomputed the
   policy model on each composer keystroke until memoized.

**`worktree-change-request-badge` — done.** `InboxThreadRow` and `ThreadHeaderModel` widened (both
discarded the fields at their output boundary), badge derived in `lib/changeRequestBadge.ts`,
rendered outlined-not-filled in the inbox row and thread context bar with "Last known state." in
every accessibility label. Wording is hard-coded "Pull request" — provider-aware wording still
needs the VCS status stream mobile has never subscribed to.

**`thread-model-picker` — done.** Grouped per provider instance with brand marks, searchable,
locked to the thread's provider once a session exists, with `loading` distinguished from
"no models" and from "search matched nothing". `ProviderIcon` now covers all five drivers with
marks copied byte-for-byte from web; an unknown driver gets a neutral glyph rather than a wrong
brand. Three of the five viewBoxes are non-square and must be width-derived, or react-native-svg
letterboxes them.

**`thread-activity-fold` — done.** Consecutive work entries collapse into
"Working…" / "Worked for 2.9s · 4 steps", expanding to tool rows with command previews and
tap-to-open output plus exit code. **Deviates from §0's "hoist, don't copy"** — see the commit for
why: web's `deriveTurnFolds` returns a Map keyed for a row pipeline mobile does not have. Wording,
grouping key and the running/settled split are identical.

**Still open: `thread-ci-checks`** — the `(icon) 3/9` checks summary. Slice 5 shipped the PR badge,
but not this. It still needs the `readRpcClient` accessor (Path B, §6), a re-implementation of
`getOverviewSummary` (not React-free), the token/styling split of `prCheckStatus`, and a
polling/battery story for M worktree lookups across N inbox threads.

Two more constraints found while building these three:

4. **Exit code 0 is falsy and meaningful.** Any "did it fail" check has to compare against null
   first. Same shape of bug as `prNumber: 0`.
5. **A default-open row cannot use a plain "expanded" id set.** Collapsing it must be recorded as
   its own fact or it springs back open on the next rebuild — and a running fold rebuilds every
   second.

## 9. Recommended order

`home-ia` → `thread-session-policy` + `thread-model-picker` (one rail, shipped together) →
`thread-activity-fold` → `worktree-change-request-badge` → `thread-ci-checks`.

`home-ia` first: felt on every launch, no dependencies, and it de-risks the fragile
`HomeScreen.test.ts` harness before a larger slice has to fight it.

Slices 2 and 3 are now recommended **together**: they share one control rail, one presentation
table, and one persistence seam — and the seam already exists, so splitting them means wiring
the same callback twice.

`thread-activity-fold` has **no dependency** on slices 2–3 and the visual audit argues for
pulling it ahead if the timeline matters more than the settings.
`worktree-change-request-badge` is fully independent and can ship at any point.
`thread-ci-checks` stays last for its polling/battery story — but Path B means it is no longer
the slice that forces a shared-package change.

## 10. Requires no design system work first

Three gaps the verification pass found that any of slices 1–4 will hit:

- **No elevation scale.** Three files emit a shadow and each hard-codes its own. Slices 1–4 all
  add a floating layer (FAB, two sheets, expandable fold cards) and will invent a fourth.
- **No radius scale.** Four distinct "card" radii already in play (16 / 20 / 22 / 24) plus a 32
  sheet radius, across 138 usages. Unlike colour there is no token layer to hang it on.
- **No segmented-group, sheet, or badge primitive.** Slices 2, 3 and 4 each need all three.
  `StatusPill.tsx` is already tone-injected and is the right host for slice 5's badge;
  `HomeModeControl.tsx` should be generalised rather than copied for the segmented groups.
- **Two glass capability gates that can disagree.** `GlassSurface.tsx:40` (@callstack, honors
  `UIDesignRequiresCompatibility`) and the nav header's expo-glass-effect check (does not).
  Setting that flag makes the header fall back to opaque while every `GlassSurface` still
  renders real glass — a visibly mismatched app.

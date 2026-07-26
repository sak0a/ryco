# Native mobile core workspace redesign

**Status:** Design decisions approved; written specification awaiting final review

**Scope:** Public `apps/mobile` and shared public client/runtime contracts. The required private
Hub capability is outlined as an integration boundary but is not authorized or implemented here.

## Summary

Ryco's native mobile app becomes a complete core workspace rather than a read-only companion. The
first screen is an actionable Inbox across connected nodes. Projects owns the hierarchy from
project to worktree to thread. Nodes owns Hub and direct connectivity. A compact context line keeps
the active `Node · Project · Worktree` visible inside every task.

The app keeps its existing Expo/React Native stack, native-stack navigation, dark iOS Liquid Glass
direction, and `@ryco/client-runtime`. It does not fork authentication, relay, synchronization,
orchestration, or mutation-readiness logic. It fills the current mobile presentation and action
gaps with focused native screens and pure, tested controllers over the existing public contracts.

The milestone includes:

- one saved Hub domain and account;
- multiple nodes from that Hub;
- direct LAN, pairing-link, and Tailscale-address connections;
- Inbox, Projects, and Nodes as the primary mobile information architecture;
- basic project, worktree, and thread creation and management;
- compose-first task creation;
- complete chat, approval, user-input, and diff-review workflows; and
- a full-screen, simplified Settings hierarchy.

Files, terminal, and advanced source-control operations remain the next milestone.

## Context and current-state audit

The native app already has valuable foundations:

- Expo SDK 56 and React Native 0.85 with a development client and Fast Refresh;
- native-stack navigation and real iOS Liquid Glass materials;
- direct-node bearer pairing and saved environments;
- hosted Hub native-session, account, directory, and relay client code;
- shared `@ryco/client-runtime` state and transport;
- a native composer module, native Markdown module, and native diff canvas;
- approvals, user-input requests, offline outbox logic, and thread detail subscriptions; and
- semantic dark-theme tokens with safe-area and keyboard infrastructure.

The current product surface does not expose those foundations as a complete mobile workspace:

- Home renders only existing threads. It cannot create a project, worktree, or thread.
- Home uses a full `Ryco / ALPHA` wordmark and compresses Pair and Settings actions into one small
  native header group.
- The connection switcher and Settings both expose environment management, producing duplicate
  navigation.
- Settings is a nested form sheet with large dead areas and an unnecessary
  `Settings → Environments → Add Environment` path.
- The Hub origin is build-time configuration. A user cannot enter a self-hosted Hub domain.
- Both Home and Thread use unvirtualized `ScrollView`s.
- Assistant messages render as plain text even though the native Markdown renderer is vendored.
- Thread review has a hardware-keyboard path but no visible touch entry from the thread screen.
- The composer ignores attachments and does not expose the full context/model controls required
  for creating work.
- The app contains no project/worktree creation flow, and `executeSendTurn` explicitly assumes an
  existing server thread.
- Some approval, user-input, and proposed-plan surfaces still use hardcoded palette colors rather
  than semantic tokens.
- The user-message bubble tokens and the rendered bubble disagree.
- Appearance steppers use 32-point controls, below the 44-point primary touch target.

This design fixes those gaps without broadening into desktop parity.

## Product decisions

The following decisions are approved:

1. Use a focused native vertical slice, not a visual-only pass or a desktop-parity rewrite.
2. Use the C1 information architecture: **Inbox / Projects / Nodes**.
3. Keep worktrees nested under Projects. A worktree is not a top-level app destination.
4. Use one saved Hub domain for this milestone. A Hub may expose multiple nodes.
5. Make Hub onboarding primary. Put QR, LAN, pairing URL, host + code, and Tailscale under
   **Direct connection**.
6. Use a compose-first New Task screen rather than a multi-step wizard.
7. Include basic project/worktree creation and management now.
8. Keep files, terminal, and advanced Git operations for the next milestone.
9. Preserve shared readiness, authorization, relay, synchronization, and orchestration behavior.
10. Preserve the dark iOS Liquid Glass visual direction while reducing glass usage to surfaces
    where material depth communicates navigation or interaction.

## Goals

- A user can configure one Hub, authenticate, select an authorized node, and reach it through the
  existing relay.
- A user can connect directly to a node using QR, pairing URL, host + code, LAN, or Tailscale.
- The app always communicates where work is running: node, project, and worktree.
- Inbox immediately surfaces working threads, pending approvals/user input, and recent work across
  connected nodes.
- A user can add a project, create or select a worktree, start a thread, send the first prompt,
  resume it, rename it, and archive it.
- Chat supports streaming Markdown, code, attachments, approvals, user-input requests, queued
  follow-ups, and reconnect.
- Review is touch-discoverable and uses the existing native diff canvas.
- Navigation remains understandable on a 320–430 point phone in portrait and landscape.
- The current desktop and web applications keep their behavior.

## Non-goals

- Multiple saved Hub accounts or simultaneous Hub sessions.
- Arbitrary offline project/worktree mutations or background mutation queues.
- Full file browsing/editing.
- A touch-optimized terminal.
- Full Git, pull-request, issue, work-item, or orchestration administration.
- A tablet split view.
- Push notifications.
- App Store/TestFlight publication and OTA rollout.
- Changes to relay framing, ticket semantics, node authority, or canonical orchestration event
  meaning.
- Replacing the shared runtime with mobile-specific transport or state.

## Information architecture

The primary workspace is a native stack with a persistent Home mode:

```text
Home
├── Inbox
│   ├── Search
│   ├── New Task
│   └── Thread
│       └── Review
├── Projects
│   ├── Add Project
│   └── Project
│       ├── Worktree
│       └── Thread
└── Nodes
    ├── Hub setup/account
    ├── Hub node
    ├── Direct connection
    └── Pair device

R menu
├── Hub account
├── Settings
└── About
```

Inbox, Projects, and Nodes are peer modes within Home. They preserve their independent scroll and
filter state. Detail screens push over Home. Back navigation returns to the exact prior mode and
position.

The app does not add a bottom tab bar. The compact segmented control below the native header makes
the three destinations visible without consuming the keyboard/composer edge or implying that
secondary tools are equal to the active task.

## Shared Home header

- Left: an R-only brand mark in one 44-point hit area.
- Center: current mode title: Inbox, Projects, or Nodes.
- Right: Search and New Task as separate 44×44 controls with an 8–10 point visual gap.
- Tapping R opens a compact app menu for Hub account, Settings, and About.
- Search is scoped to the current Home mode and preserves its query when the user visits a detail
  screen.
- The old full wordmark/stage badge is removed from the workspace header. Build stage remains
  available in About/diagnostics.
- Header controls receive explicit accessibility labels and visible pressed feedback.

## Inbox

Inbox answers one question: **What needs attention now?**

Sections:

1. **Active now** — running turns, pending approvals, pending user input, reconnecting delivery,
   and delivery-unknown states.
2. **Recent** — idle threads ordered by the existing recency selector.

Each row shows:

- thread title;
- status as icon/shape plus text;
- `Node · Project · Worktree` metadata;
- updated time where space permits; and
- an optional bounded diff summary.

The default scope is **All connected nodes**. A compact scope control can filter to one node.
Filtering changes presentation only; it does not connect, disconnect, or change mutation
authority.

Inbox uses a virtualized list. Empty states distinguish:

- no Hub/direct connection;
- connected node with no projects;
- projects with no threads; and
- filtered scope with no matching threads.

The primary empty-state action routes to the missing prerequisite rather than showing a generic
button.

## Projects

Projects owns the hierarchy:

```text
Node
└── Project
    ├── Local workspace
    ├── Worktree
    │   └── Threads
    └── Threads not attached to a worktree
```

The Projects root groups projects by node and shows node connectivity. A project row shows title,
repository/path context, worktree count, active-thread count, and a bounded source-control summary.

### Add Project

The user:

1. selects a connected, mutation-ready node;
2. enters or pastes a remote workspace path;
3. reviews the inferred project title;
4. confirms.

The app dispatches the existing `project.create` command. Workspace paths remain node-owned. The
mobile client keeps only the same bounded project metadata already present in synchronized shell
state.

Project creation is unavailable while the node is stale, reconnecting, unauthorized, or
read-only. It is never queued offline.

### Project detail

Project detail shows:

- local/default workspace;
- active worktrees;
- archived worktrees behind progressive disclosure;
- threads grouped by worktree;
- source-control summary; and
- Add Worktree and New Task actions.

Basic actions:

- rename project;
- add/select worktree;
- rename/archive/restore worktree;
- create/resume/rename/archive thread.

Destructive deletion, branch deletion, and advanced Git actions are deferred.

### Worktree creation

The user chooses a branch name and the app uses the existing server-managed worktree preparation
flow. The app does not derive filesystem paths or run Git locally. It records the resulting
worktree through the existing orchestration commands/events.

The UI shows one optimistic **Creating worktree…** row. It becomes authoritative only after the
node event arrives. Failure removes the optimistic row, preserves the New Task draft, and presents
a bounded actionable error.

## New Task

New Task is one compose-first screen. The editor is focused on entry.

Visible controls:

- prompt/editor;
- attachment action;
- context control: Node, Project, Worktree;
- provider/model;
- runtime/execution mode;
- send.

The context control uses full-screen or bottom-sheet pickers, not nested modal cards. It always
renders the complete active context in a compact two-line summary.

Defaults:

- use the current node scope when launched from Inbox or Nodes;
- use the current project/worktree when launched from Projects or an existing thread;
- otherwise use the last mutation-ready context;
- never silently select a stale or unauthorized node.

If no project exists, the same screen expands an inline Add Project step. If **New worktree** is
selected, branch input appears in the context sheet. The prompt remains mounted throughout; the
user never loses the draft while configuring context.

### Send sequence

The controller performs only the missing steps:

1. create project, if needed;
2. prepare and record worktree, if requested;
3. create thread;
4. start the first turn.

Every command uses a stable generated command ID. The controller does not silently retry
non-idempotent steps. It waits for the required authoritative state transition before dispatching
a dependent step.

On failure:

- retain prompt and attachments;
- retain successful earlier objects;
- identify the failed step in user-facing language;
- provide an explicit retry for that step; and
- never report the turn as started when delivery is uncertain.

The controller is headless and testable without React Native.

## Thread

Thread is the focused work surface.

Header:

- native Back action;
- thread title and bounded running state;
- visible Review action when a diff is available;
- More menu for rename, archive, stop/cancel, copy link, and thread details.

Immediately below the header, a compact tappable context line renders:

```text
Node · Project · Worktree
```

It remains visible while reading and composing. Tapping it opens context details; changing a
thread's project/worktree uses existing supported attachment semantics and explicit confirmation.

Timeline:

- virtualized, keyboard-aware list;
- native selectable Markdown for assistant messages;
- syntax-highlighted code with visible copy actions;
- quiet neutral user bubbles rather than stark primary white;
- proposed plans, context compaction, tool/work log, approvals, and user-input requests;
- streaming updates without full-list re-render; and
- preserved scroll position across rotation and navigation.

Composer:

- uses the existing native composer editor;
- supports text and attachments;
- exposes provider/model and execution controls;
- sends immediately when mutation-ready;
- queues supported follow-ups through the existing bounded outbox;
- retains the draft on failure;
- stays above safe areas and the software keyboard; and
- uses a 44-point send target.

Pending approvals and user-input requests remain above the composer, wrap actions, and stay
operable with the keyboard open.

## Review

Review remains a full-screen push surface using the existing native diff canvas.

- A touch-visible Review action is present in Thread.
- The screen shows loading, empty, error, and stale/read-only states.
- File selection and diff navigation remain inside the review surface.
- Comment-on-selection continues through the existing comment composer.
- Editor launch and advanced source-control actions remain unavailable on mobile.
- Back returns to the same thread and scroll state.

## Nodes

Nodes owns connection setup, switching, status, and repair. Settings no longer duplicates an
environment list.

Order:

1. configured Hub and its authorized nodes;
2. direct saved connections.

Hub node rows show bounded name, presence, effective role, selection, and relay state. Selection
uses the existing fail-closed Hub controller and remains disabled until directory and browser
state are current.

Direct connection methods:

- scan QR;
- paste pairing URL;
- enter host + pairing code;
- enter a LAN or Tailscale-reachable host.

Tailscale is a direct transport label, not a separate account or authorization plane. Direct
credentials never enter Hub requests, and Hub DPoP material never enters direct-node requests.

## One-Hub profile and self-hosted domain

The app stores one Hub profile:

- normalized HTTPS origin;
- bounded display label;
- last compatibility result and timestamp; and
- no credential material.

A build may prefill a default origin. The user may replace it during onboarding or from
Settings → Hub. Domain normalization requires:

- absolute HTTPS origin;
- no credentials;
- no query or fragment;
- no path other than `/`;
- no placeholder or malformed host; and
- development-only explicit allowance for loopback/insecure origins.

Before authentication, the app fetches a bounded, unauthenticated capability document. It proves
protocol version, supported native handoff mode, and public relying-party metadata without
exposing internal configuration.

### Arbitrary-domain authentication constraint

iOS native passkeys work only for relying-party domains present in the signed app's associated
domains. An App Store build cannot enumerate every future self-hosted Hub. Therefore arbitrary Hub
domains use an ephemeral system-browser authentication and a one-time browser-to-native handoff.

The required server-side protocol is a separate private, security-reviewed prerequisite. Its
public client contract must guarantee:

1. the app creates or loads its non-exportable hardware-backed DPoP key;
2. the app starts a short-lived handoff bound to that public key;
3. the Hub returns a browser URL plus app-held polling/completion material;
4. the user authenticates on the Hub's own origin in an ephemeral system browser;
5. the authenticated browser explicitly approves connecting the native app;
6. the app proves possession of the same DPoP key and completes the handoff;
7. the Hub returns a DPoP-bound native session;
8. the app stores the token in SecureStore; and
9. browser cookies never enter the app.

No session token, polling secret, proof, ticket, challenge, or credential appears in a browser URL,
app deep link, log, analytics event, or non-secret persistence.

Changing the Hub domain:

1. requires explicit confirmation;
2. signs out and revokes/clears the current native session as supported;
3. closes the selected Hub relay;
4. clears Hub-scoped directory/account state;
5. preserves direct saved connections; and
6. validates the replacement origin before enabling authentication.

## Settings

Settings is a full-screen native stack, not a nested form sheet.

Top-level groups:

### Hub

- domain and compatibility status;
- account/security;
- passkeys;
- recovery methods;
- password/TOTP/email where the Hub supports them;
- sign out.

### Workspace defaults

- preferred node;
- default project/worktree behavior;
- provider/model;
- runtime/execution mode.

### Appearance

- base text size;
- code text size;
- code wrapping;
- future theme choice without exposing an inert control now.

### App

- notifications only when implemented;
- local storage;
- diagnostics;
- privacy;
- About, version, build stage, and licenses.

Routine node switching, pairing, reconnect, and removal remain in Nodes.

## Visual design

The existing dark iOS Liquid Glass language remains.

Glass is limited to:

- native navigation/header material;
- segmented Home control;
- compact context controls;
- sheets and popovers;
- composer.

Lists, settings groups, messages, projects, and connection rows use quiet opaque or translucent
token surfaces. This prevents nested glass-on-glass cards and keeps hierarchy legible.

Approved adjustments:

- R-only brand mark;
- separate 44×44 header actions with 8–10 points between them;
- DM Sans/system-native hierarchy already present in the app;
- neutral graphite user-message bubble with semantic foreground tokens;
- semantic accent, warning, danger, success, and plan tokens;
- no raw `amber`, `sky`, or `violet` utility colors in feature screens;
- varied radii: tighter rows and controls inside softer sheets/surfaces;
- subtle native spring transitions with Reduce Motion fallbacks; and
- skeletons shaped like the real Inbox/Projects rows rather than generic spinners.

## Component and module boundaries

### `apps/mobile`

Owns:

- `HomeMode` navigation state and presentation;
- Inbox, Projects, Nodes, New Task, Thread, Review, and Settings screens;
- native list rows, context controls, and sheets;
- screen-specific pure view models;
- mobile Hub-profile persistence adapter; and
- platform interactions such as browser handoff and SecureStore.

Suggested feature boundaries:

```text
src/features/inbox/
src/features/projects/
src/features/newTask/
src/features/nodes/
src/features/threads/
src/features/settings/
src/features/hostedHub/
```

No single screen file owns transport, orchestration sequencing, state derivation, and rendering
together.

### `packages/client-runtime`

Receives only logic that is platform-neutral or has more than one real client consumer:

- shared scoped selectors needed by Inbox/Projects;
- headless project/worktree/thread action helpers where web can consume them;
- the public capability/handoff client contract after its separate protocol design; and
- existing readiness, connection, authorization, relay, state, and outbox logic unchanged.

It remains React-, DOM-, and React-Native-free.

### Public contracts

Existing project, worktree, thread, and turn commands remain canonical. Any new Hub
capability/handoff schema lands publicly before a private server implementation consumes it. No
private schema or compatibility fixture is copied into the public app.

### Private Hub

The Hub owns the capability response, authenticated browser approval, native session issuance,
rate limits, expiry, replay protection, persistence, audit behavior, and security policy for the
handoff. This public design does not authorize or implement those changes.

## Data flow and authority

```text
Hub profile (non-secret KV)
  └── capability check
      └── browser authentication + hardware-key handoff
          └── native session (SecureStore)
              └── authorized node directory
                  └── selected node relay
                      └── standard node RPC/orchestration stream

Direct pairing
  └── direct bearer (SecureStore)
      └── saved-environment supervisor
          └── standard node RPC/orchestration stream

Node stream
  └── @ryco/client-runtime state
      ├── Inbox selectors
      ├── Projects selectors
      ├── Thread detail
      └── Review queries
```

The remote node remains authoritative for projects, worktrees, threads, messages, approvals,
files, terminals, source control, and provider sessions. The Hub remains metadata/control plane
and opaque relay. The mobile client persists only bounded preferences, drafts, connection
metadata, and credentials in their designated stores.

## Error and lifecycle behavior

All surfaces render stable, bounded user-facing states.

### Connection

- Connected
- Reconnecting
- Checking access
- Synchronizing
- Offline
- Read-only
- Delivery unknown
- Update required/incompatible

Mutations consume the shared capability/readiness decision. Screens do not infer safety from a
green dot or raw socket state.

### Project/worktree/task creation

- Each dependent step waits for authoritative confirmation.
- Non-idempotent writes are not silently retried.
- Successful earlier steps remain visible after a later failure.
- Draft content and attachments remain available.
- A retry button names the failed operation.
- Raw filesystem, RPC, SQLite, stack, or provider details never appear.

### App lifecycle

- Background suspends hosted relay work through the existing mounted lifecycle owner.
- Foreground revalidates Hub authorization/directory and reconnects before mutations resume.
- Direct connections use the existing supervisor resume seam.
- Rotation preserves Home mode, filters, navigation route, draft, timeline position, and selected
  review file.
- Domain changes and sign-out tear down only Hub-scoped state.

## Security and privacy invariants

- No second auth, relay, synchronization, or mutation-readiness implementation.
- Hardware-backed non-exportable DPoP key remains mandatory for native Hub sessions.
- Hub and direct transports remain isolated.
- Browser cookies never enter native requests.
- Native DPoP headers never enter browser requests or direct-node requests.
- Fresh relay ticket per attempt; no ticket caching or replay.
- Relay buffers retain no ticket/auth/payload material after ownership transfer.
- No credentials, proofs, challenges, polling secrets, tickets, signatures, request bodies,
  prompts, conversation text, paths, source content, or relay payloads in logs, analytics,
  diagnostics, errors, or configuration exports.
- Hub-domain capability failures reveal only bounded compatibility reasons.
- Workspace paths remain node-owned content and are not copied into Hub persistence.

## Accessibility and input

- Primary touch targets are at least 44×44 points.
- State uses icon/shape and text, never color alone.
- Dynamic Type up to 200% does not hide controls or introduce page-level horizontal overflow.
- VoiceOver order follows visual order.
- Icon-only controls have explicit labels and hints.
- Approval arrival and delivery-unknown use appropriate live announcements.
- Sheets trap and restore focus.
- Composer, approval actions, pickers, and menus remain above the software keyboard.
- Landscape safe areas are honored.
- Reduced Motion disables nonessential spring/stack motion.
- Hardware keyboard shortcuts keep visible touch equivalents.

## Performance

- Inbox and Thread use virtualized lists.
- Selectors are scoped and shallow-stable across environments.
- Streaming updates patch affected rows rather than rebuilding the entire timeline.
- Markdown parsing/highlighting is incremental and cached by message revision.
- Diff rendering remains in the native canvas.
- Node/project/worktree pickers page or virtualize large directories.
- Home mode changes preserve mounted list state where memory permits.

## Verification

### Automated public gates

Run:

```sh
bun install --frozen-lockfile
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
bun run --cwd apps/mobile test
bun run --cwd apps/mobile typecheck
cd apps/mobile && APP_VARIANT=development ./node_modules/.bin/expo config
```

Use the exact Bun version pinned by the repository. Never run `bun test`.

### Focused automated coverage

Pure tests cover:

- Inbox grouping, priority, scoping, and empty states;
- Projects hierarchy and authoritative reconciliation;
- New Task defaults and project/worktree/thread/turn sequencing;
- partial failure, explicit retry, and draft preservation;
- Hub-origin normalization and domain-change reset plan;
- capability incompatibility;
- readiness/mutation gates;
- thread header Review visibility and action models;
- Settings routing;
- semantic token resolution; and
- no credential/proof/ticket material in view models or persistence.

The current test runner cannot import/mount React Native screens. Screen decisions and lifecycle
coordination therefore live in pure models/controllers. Every mount effect receives manual source
review and interactive validation.

### Simulator QA

Use the Expo development client and Fast Refresh to validate:

- R mark and separated header actions;
- Inbox, Projects, and Nodes with empty and populated fixtures/live node state;
- adding a project by remote path;
- creating a worktree and first task;
- draft preservation through navigation and failure;
- streaming Markdown/code and attachments;
- approvals and user-input requests;
- Review entry and native diff canvas;
- reconnect, offline outbox, and delivery-unknown;
- full-screen Settings;
- keyboard, safe areas, rotation, Dynamic Type, reduced motion, and accessibility labels; and
- no horizontal overflow on supported phone sizes.

### Real-device/deployed-Hub qualification

Simulator results are not device evidence. A real device and deployed compatible Hub are required
for:

- hardware-backed DPoP key behavior;
- arbitrary-domain browser handoff;
- native passkeys and associated domains;
- Keychain persistence across restart/update;
- camera QR pairing;
- Hub node directory and relay data path;
- background/foreground relay recovery; and
- node switching teardown.

The private Hub prerequisite receives its own security spec, implementation plan, full Hub gate
set, adversarial review, and explicit owner approval before deployment.

## Delivery sequence

Each step keeps the app runnable:

1. **Foundation audit fixes** — semantic tokens, R mark, 44-point controls, header spacing,
   Markdown wiring, virtualized lists, visible Review action.
2. **Home shell** — Inbox / Projects / Nodes, persistent mode state, search, scope control, R menu.
3. **Projects** — hierarchy selectors, project detail, project/worktree basic actions.
4. **New Task** — compose-first screen and tested sequencing controller.
5. **Thread completeness** — native composer, attachments, Markdown, actions, approval/input
   keyboard behavior, context line.
6. **Settings** — full-screen stack and removal of duplicate environment hierarchy.
7. **One-Hub client profile** — domain validation, capability client, domain reset behavior, gated
   browser-handoff adapter.
8. **Private Hub prerequisite** — separately approved/spec'd capability and native handoff.
9. **Integration and qualification** — direct regression, deployed Hub/device matrix, security
   review, performance/accessibility pass.

Public steps that do not depend on the new handoff may land first. The Hub domain field remains
development-gated until the compatible server handoff exists; it must never ship as a
tappable-but-broken production path.

## Acceptance criteria

The milestone is complete only when:

- Home uses Inbox / Projects / Nodes and preserves each mode's position/state.
- The R-only mark and separated header actions meet touch/accessibility requirements.
- A user can connect directly through QR, pairing URL, LAN host, or Tailscale-reachable host.
- A user can configure one compatible Hub domain and complete the security-reviewed native
  session handoff on a real device.
- Authorized Hub nodes populate and connect through the existing relay.
- Every thread displays Node, Project, and Worktree context.
- A user can add a project, create/select a worktree, create a thread, and start the first turn.
- A user can resume, rename, archive, and steer a thread.
- Markdown, code, attachments, approvals, user input, queued follow-ups, and diff review work on
  mobile.
- Reconnect and app lifecycle never enable mutations before shared readiness is current.
- Settings is full-screen and contains no duplicate environment browser.
- Automated public and affected private gates pass.
- Simulator QA passes for layout/input behavior.
- Real-device/deployed-Hub evidence passes for native auth, secure storage, camera, relay, and
  lifecycle behavior.
- Diff and log review find no credential, private-data, schema-boundary, or unrelated changes.

## Follow-up milestone

After this core workspace is accepted:

- files and file preview/editing;
- terminal with mobile input ergonomics;
- advanced Git/source-control actions;
- pull-request, issue, and work-item workflows;
- tablet/adaptive split view;
- push notifications;
- multiple saved Hubs if product demand justifies the additional identity/state complexity; and
- EAS/TestFlight/OTA release work.

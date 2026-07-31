# Sidebar Inbox Rich Rows

## Goal

Make the web Inbox easier to scan without hiding context. Active work should read as compact task
cards; settled history should stay dense. Hovering either form should reveal the full thread context
in a stable detail card.

This is a visual refinement of the approved global Inbox and settlement lifecycle. It does not
change classification, filtering, navigation, or server semantics.

## Reference and direction

The implementation follows the information hierarchy in `pingdotgg/t3code` Sidebar V2 at commit
`acf761b2`: active card rows, slim settled rows, project favicons, provider identity, and a
right-aligned detail tooltip. Ryco keeps its existing design tokens and multi-environment behavior.

## Row hierarchy

Active rows use a three-line compact card:

1. Project favicon and project name; status or relative time at the right.
2. Thread title as the strongest text.
3. Workspace/branch context at the left; PR, remote-environment, and provider indicators at the
   right.

The right-side status slot changes to the existing Settle action on hover or keyboard focus without
moving the project label. Running, approval, input, queued, failed, and draft states use concise
labels; an ordinary ready row shows its relative activity time.

Settled rows use one slim line: dimmed project favicon, thread title, optional provider indicator,
and settlement time. Hover or keyboard focus replaces the time with Move to Active. The currently
routed row remains visually selected.

## Hover detail card

After a short hover delay, a card opens to the right of the row. It contains:

- full thread title;
- project favicon and project name;
- environment label;
- workspace/worktree title when it adds information;
- branch;
- provider icon and friendly model label, falling back to the stored model slug;
- pull-request state when present;
- the current blocking or failure state when present.

The tooltip is supplementary: every action remains keyboard reachable and no essential state is
available only on hover.

## Data flow

`SidebarThreadSummary` exposes the shell's existing `modelSelection` and sanitized error value.
This adds no server payload because both already exist in the shell contract. The global Inbox
builds provider-instance lookup maps from the primary server configuration and each connected saved
environment's configuration. Rows fall back to session driver data when a provider snapshot is not
available, preserving mixed-version and disconnected-environment behavior.

`SidebarInboxRow` receives resolved provider presentation data as props and remains independent of
connection stores. Project artwork uses the existing `ProjectFavicon`, including custom avatars and
remote environment URLs.

## Reliability and accessibility

- Capability, readiness, and lifecycle blockers continue to own action availability.
- Tooltip content never triggers network or lifecycle mutations.
- The entire row remains a button-like navigation target; Settle and Move to Active remain separate
  accessible buttons and context-menu actions.
- Long titles, paths, branches, model names, and environment labels truncate in rows and remain
  readable in the hover card.
- Drafts and old-server rows render useful context while keeping unsupported actions disabled.

## Verification

- Runtime tests cover model/error projection into sidebar summaries.
- Browser component tests cover rich active and slim settled presentation, provider/model details,
  and unchanged action availability.
- Live browser QA checks hover placement, selected/hover states, filtering, settle/unsettle, and
  console errors at desktop sidebar width.
- The repository and browser backstops are rerun after the refinement.

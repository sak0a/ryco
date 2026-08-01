# Status Board lane breathing room

## Goal

Make the approved compact Status Board slightly easier to scan without increasing the panel width
or returning to the taller original layout. Remove repeated lane metadata, especially the
Environment presentation where values such as `Local` and `local` can appear as both description
and expanded content.

This is the approved **40px balanced lane** refinement to the compact Status Board design.

## Scope

The change applies only to `SectionLane` rows in the Status Board overview layout. The sidebar,
floating, and sheet panel widths remain unchanged. The 36px branch selector header, Git actions,
other overview layouts, source-control behavior, and responsive presentation policy remain
unchanged.

## Lane geometry and hierarchy

Each Status Board lane header increases from a 36px minimum height to 40px. Icon size, summary
metrics, chevrons, link targets, and horizontal padding stay at their current compact sizes. The
extra four pixels provide vertical breathing room rather than making the interface visually heavy.

When a lane has a subtitle, the title area becomes a compact two-line stack inside the 40px header:

- title on the first line;
- subtitle on the second line in the existing muted 10px treatment;
- summary metrics and actions remain aligned at the trailing edge.

The subtitle is no longer rendered again below the header when the lane opens. Lanes without a
subtitle retain a vertically centered single-line title.

## Environment metadata deduplication

The Environment lane treats its header as the authoritative summary:

- `Environment` remains the lane title;
- the environment target appears once as the subtitle;
- a distinct status appears once in the trailing summary badge;
- a status that matches the target after trimming and case normalization is suppressed;
- target and status are not repeated as `Target` and `Status` rows in an expanded body.

Because the available Environment data currently contains no additional fields beyond target and
status, the Environment row is informational and non-expandable. It must not render a chevron,
button semantics, or `aria-expanded` until novel detail fields exist. This avoids an empty or
duplicated disclosure while keeping warning or connection information visible when it is distinct.

## Interaction and accessibility

Expandable lanes preserve their current click, keyboard, focus, and `aria-expanded` behavior.
Pull-request external links remain independent of the disclosure trigger. The non-expandable
Environment row uses non-interactive row semantics and does not imply that hidden content exists.

Long titles and subtitles truncate before summary metrics, the external-link action, or the
chevron are displaced. The 40px lane headers must continue to fit the existing 340px sidebar and
narrower floating/sheet widths without horizontal overflow.

## Component design

`SectionLane` accepts optional body content. It derives whether the row is expandable from the
presence of meaningful children and renders either the existing disclosure button or a static row
with the same visual grid. Title and subtitle share one reusable text-stack treatment in both
variants.

`StatusBoardLayout` supplies no body content for Environment. A small normalization helper compares
the target and status before producing the summary badge. Other Status Board lanes retain their
existing bodies, ordering, default-open state, metrics, links, and actions.

The shared `EnvironmentContent` component remains available to the stack and hybrid layouts, which
are outside this refinement and should retain their current presentation.

## Testing

Update unit and browser coverage to verify:

- Status Board lane headers have a 40px minimum height;
- subtitles render once inside lane headers and are not repeated in expanded content;
- Environment displays its target once;
- case-only target/status duplicates such as `Local` and `local` are suppressed;
- a distinct Environment status remains visible;
- Environment is non-expandable and has no disclosure semantics;
- Changes, checks, plan, subagent, and pull-request lanes preserve expansion and external-link
  behavior;
- panel width, branch selector height, and Git actions remain unchanged.

Run the complete repository backstop and the required web build and browser suite from `AGENTS.md`
because this changes web interaction and responsive layout.

## Non-goals

- Increasing panel width
- Increasing the branch selector height
- Changing lane order, default expansion, data sources, or source-control behavior
- Adding environment fields that are not currently available
- Changing stack or hybrid overview layouts
- Changing the frozen web phone tier or native mobile presentation
- Adding packages, contracts, RPC fields, or persistence

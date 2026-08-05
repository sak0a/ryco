# Context Handoff Inspection and Export Design

**Date:** 2026-08-05  
**Status:** Approved for implementation planning  
**Scope:** Supported web desktop and tablet context-handoff surfaces

## Summary

Ryco will make completed context handoffs inspectable and exportable without adding large context
bodies to normal thread synchronization. The existing timeline divider remains compact. Hover or
keyboard focus reveals small factual metadata, while activating the divider opens a detail panel.
The panel distinguishes the exact context sent to the target provider from the complete canonical
artifact that Ryco prepared.

Users can inspect either artifact in a readable structured view and export either one as
deterministic Markdown or JSON. This serves two goals:

1. **Transparency:** show what the target provider actually received after input-budget trimming.
2. **Portability:** allow the richer complete artifact to be reused or archived outside Ryco.

The feature does not introduce an AI-generated summary. All presentation and export output is
deterministic and derived from persisted handoff artifacts.

## Current Behavior

A version 1 context handoff builds a deterministic `ContextHandoffDocument` from canonical Ryco
history before the triggering user message. The document includes allow-listed messages, plans,
useful tool results, checkpoint summaries, relevant notices, completed subagent summaries, and
prior handoff boundaries. It excludes hidden reasoning, protocol noise, telemetry, prior context
bodies, target startup events, and the triggering message.

The complete structured document and its digest are stored in the server-local
`provider_context_handoffs` table. Immediately before provider delivery, Ryco renders a subset that
fits the target input budget and wraps it together with the exact current user message. The current
implementation does not persist that rendered provider input. The web client receives only small
boundary metadata and the complete-document digest.

Consequently, current handoffs can prove which complete artifact was prepared but cannot later
prove the exact budget-trimmed bytes delivered to the provider.

## Goals

- Make the timeline divider discoverably interactive without making it visually heavy.
- Show small, non-sensitive handoff facts on hover and keyboard focus.
- Present the sent and complete artifacts as distinct, accurately labeled scopes.
- Preserve the exact rendered provider input before delivery.
- Export either scope as deterministic Markdown or JSON.
- Keep large artifact bodies out of snapshots, push streams, logs, analytics, caches, and normal
  thread payloads.
- Keep direct, desktop, and hosted connections on the existing authenticated RPC path.
- Remain bounded and predictable for long threads and large exports.
- Represent failed, delivery-uncertain, and legacy handoffs without overstating what was sent.

## Non-goals

- Generating an LLM-authored summary of the handoff.
- Editing a persisted handoff or resending it from the inspection panel.
- Exporting hidden provider reasoning or data excluded by the current allow-list.
- Adding this flow to the frozen web-phone presentation tier.
- Adding native mobile UI in this change.
- Publishing shareable or unauthenticated download URLs.
- Backfilling an exact sent payload for handoffs created before exact-payload persistence exists.

## User Experience

### Timeline divider

The existing divider becomes a button with the same compact visual treatment. It remains readable
as a boundary first; interactivity is conveyed through a subtle hover/focus surface and cursor, not
through a new persistent action icon.

When summary metadata is available, hover or keyboard focus shows:

- source and target provider/model presentation;
- delivery status and timestamp;
- included entries compared with total entries;
- whether the rendered context was trimmed.

The hover surface contains no messages, commands, paths, or export actions. This avoids accidental
content disclosure and keeps the interaction useful on dense timelines. Touch users activate the
divider directly.

### Detail panel

Activating the divider opens a right-side detail panel on desktop. On touch/tablet layouts it uses
the existing sheet presentation pattern. The panel manages focus, closes with Escape, and restores
focus to the divider.

The header shows:

- source lineage and target using the same provider icons and picker-friendly names as the divider;
- terminal handoff status;
- creation and delivery timestamps when available;
- complete-artifact and exact-payload digests in a collapsed integrity section.

For a consumed handoff, the default scope is **Sent to model**. A second scope,
**Complete artifact**, exposes the untrimmed canonical document. The selected scope controls both
the readable preview and export actions.

The readable preview groups entries into the document's existing sections:

1. Messages
2. Plans
3. Tools and terminal results
4. Checkpoints and changed files
5. Notices and pending questions
6. Subagents
7. Prior handoffs

Each section displays its entry count and loads its content only when opened. Content uses existing
chat, code, path, status, and provider presentation primitives where practical. A secondary
**Raw payload** view is available on demand for users who need byte-oriented inspection; it is not
the default reading experience.

When the sent scope is smaller than the complete scope, the panel states the number of omitted or
compacted entries and explains that the provider input budget caused the difference. It never calls
the deterministic artifact a “summary.”

### Export actions

An export menu applies to the selected scope and offers:

- **Readable Markdown** (`.md`)
- **Structured JSON** (`.json`)

Together, the two scopes and two formats produce four possible exports:

- sent Markdown;
- sent JSON;
- complete Markdown;
- complete JSON.

The sent JSON export contains the immutable stored delivery artifact, including the exact provider
input string and structured rendered context. The complete JSON export contains the canonical
`ContextHandoffDocument` plus its integrity metadata. Markdown preserves the same section order and
explicitly labels scope, delivery status, truncation, provenance, and digest.

The export menu includes a concise notice that files may contain conversation text, commands,
tool output, repository paths, and other sensitive project context. Export remains a single
intentional action; no additional confirmation modal is required.

Filenames are server-provided, sanitized, and stable:

`ryco-context-handoff-<handoff-id>-<sent|complete>.<md|json>`

## Artifact Model

### Complete artifact

The existing structured context remains the immutable complete artifact. Its schema version and
SHA-256 digest retain their current meaning. It is built once and stored with compare-and-set
semantics before target delivery.

### Delivery artifact

Ryco adds a nullable immutable delivery artifact to the context-handoff persistence model. It is
stored after rendering and before the provider delivery call. A delivery artifact contains:

- artifact schema version;
- renderer/envelope version;
- rendered structured context;
- exact provider input string, including the context envelope and triggering message;
- rendered-context digest;
- provider-input digest;
- total and included entry counts;
- rendered context and provider input character counts;
- truncation flag;
- preparation timestamp.

The exact provider input is intentionally persisted rather than reconstructed later. This prevents
renderer changes, input-limit changes, or later message projection changes from altering the audit
result. The rendered structured context is also retained so the panel can present the sent scope
without parsing the provider envelope.

The delivery artifact is bounded by the same provider-input limit that already governs dispatch.
The complete artifact may be larger and therefore remains lazy-loaded and paginated.

### Status semantics

- **Consumed:** the delivery artifact is labeled “Sent to model.”
- **Failed before rendering:** only the complete artifact may be available; the UI says
  “Prepared, not sent.”
- **Failed after rendering but before acceptance:** the delivery artifact is labeled
  “Prepared payload, not accepted.”
- **Delivery uncertain:** the delivery artifact is labeled “Attempted payload; delivery
  uncertain.”
- **Legacy record without a delivery artifact:** the complete artifact remains available, while
  the sent scope says “Exact sent payload unavailable for this handoff.” Ryco does not reconstruct
  or backfill an allegedly exact payload.

## Timeline Metadata

Terminal handoff activities gain an optional bounded inspection summary:

- complete entry count;
- rendered included entry count when available;
- rendered truncation flag when available;
- complete artifact digest;
- delivery artifact digest when available;
- prepared and accepted timestamps when available.

All new fields are optional for backward compatibility. This summary is sufficient for hover/focus
without fetching a body. Context bodies and the exact user message are not added to the activity.

## Server Interfaces

All interfaces use the existing authenticated RPC transport and verify that the requested handoff
belongs to the requested thread and that the principal may read that thread.

### Detail summary

`contextHandoff.getInspectionSummary` accepts a thread ID and handoff ID. It returns:

- immutable handoff identity, provenance, status, and timestamps;
- availability of sent and complete scopes;
- count, truncation, size, section-index, and digest metadata for each scope;
- the reason a scope is unavailable.

The method does not return entry bodies.

### Section pages

`contextHandoff.listInspectionEntries` accepts:

- thread ID and handoff ID;
- scope (`sent` or `complete`);
- section name;
- opaque cursor;
- bounded requested item count.

The server enforces both an item-count limit and an encoded-byte limit. The response includes a
next cursor only when more entries remain. Cursors bind to the handoff, scope, section, and artifact
digest so they cannot be replayed against another artifact.

### Raw payload pages

`contextHandoff.readRawPayloadChunk` returns a bounded UTF-8 range for the selected immutable scope.
Responses include offset, total bytes, digest, and the next offset. The raw sent scope reads the
exact provider input. The raw complete scope reads canonical JSON.

### Export chunks

`contextHandoff.readExportChunk` accepts the handoff, scope, format, and byte offset. It returns a
bounded chunk plus filename, total bytes, digest, and next offset. The export is deterministic for a
given artifact digest, scope, format, and export-format version.

The server may keep a small bounded TTL cache of generated export bytes keyed by those immutable
values. Cache eviction only affects performance: any chunk can be regenerated. A server restart
therefore causes at most a retry, not a corrupt or semantically different export.

The client requests offsets sequentially, rejects duplicates or gaps, assembles a Blob in memory,
verifies the final digest with Web Crypto, and starts the download only after verification. Closing
the panel or cancelling the export aborts outstanding requests and releases accumulated chunks.

## Deterministic Markdown

Markdown export is implemented by a server-side formatter that consumes the same typed handoff
document used by JSON export. It does not scrape rendered React output.

The document starts with metadata and provenance, followed by the fixed section order used by the
panel. It preserves timestamps, roles, statuses, commands, outputs, paths, file counts, plan-step
states, and truncation markers. Content is fenced and escaped so commands or tool output cannot
break the surrounding Markdown structure. Empty sections are omitted.

The sent Markdown export includes the triggering user message in a clearly separate final section
because it was part of the exact provider input. The complete Markdown artifact omits that message,
matching the existing canonical-document boundary.

## Client Boundaries

The inspection panel owns ephemeral fetch and export state. Artifact bodies are not written to
client persistence, the query cache, local storage, service-worker storage, thread state, or global
application atoms. Closing the panel clears loaded entry pages and raw chunks.

The timeline continues to render entirely from the existing thread activity. Opening or closing
inspection cannot change thread selection, model selection, provider sessions, or mutation
readiness.

The feature is limited to supported desktop and tablet web tiers. It reuses shared authorization,
transport, orchestration, and persistence policy; it does not introduce a separate phone runtime or
extend the frozen web-phone tier.

## Privacy and Authorization

- Every summary, page, raw, and export request revalidates thread access server-side.
- Supplying a valid handoff ID without access to its owning thread returns the same not-found-style
  result as an unknown handoff.
- Artifact bodies, export contents, message text, commands, and paths are never logged or attached
  to tracing spans, metrics, analytics, diagnostics, or error reports.
- Metrics may record only bounded counts, byte totals, durations, statuses, and format/scope labels.
- The production service worker must not cache inspection or export RPC traffic.
- No temporary public URL or bearer credential is created for export.
- Client-side error messages contain operation and status information, not context excerpts.

## Error Handling

- Failure to load inspection data leaves the timeline divider intact and shows a retryable panel
  error.
- An unavailable scope explains why it is unavailable and leaves the other scope usable.
- A digest mismatch fails closed: content is not displayed or downloaded, and the panel offers a
  clean retry.
- Invalid or stale cursors fail without returning partial content.
- Export chunk gaps, overlaps, reordering, total-size changes, or digest changes cancel the export.
- Closing the panel aborts outstanding requests without server-side mutation.
- Server restart during export is recoverable by restarting the deterministic export from offset
  zero.
- Legacy records remain readable through the complete scope and never claim exact-delivery proof.

## Accessibility

- The divider is a semantic button with a descriptive accessible name that includes source, target,
  and status.
- Metadata available on hover is also available on focus; no required action depends on hover.
- Focus moves into the panel on open and returns to the originating divider on close.
- Scope controls, section disclosures, raw view, and export menu are fully keyboard operable.
- Status, trimming, and availability are expressed in text rather than color alone.
- Long content uses semantic headings and landmarks so assistive technology can navigate sections.

## Testing Strategy

### Contracts and persistence

- Decode old records and activities with absent delivery artifacts and inspection metadata.
- Migrate the handoff table without rewriting existing structured artifacts.
- Store the delivery artifact exactly once before delivery and preserve compare-and-set behavior.
- Reject mismatched digests, malformed artifacts, and partial delivery-artifact writes.

### Rendering and export

- Snapshot exact provider input, rendered context, counts, sizes, and digests.
- Verify full, trimmed, compacted, failed, uncertain, and legacy states.
- Verify deterministic JSON and Markdown byte output across repeated calls.
- Verify Markdown escaping for fences, paths, commands, tool output, and Unicode.
- Verify chunk boundaries, regeneration after cache eviction, and final digest validation.

### RPC and authorization

- Allow access only when the handoff belongs to an accessible requested thread.
- Return not-found-style failures for cross-thread and unauthorized handoff IDs.
- Enforce page item/byte bounds and export chunk bounds.
- Reject stale cursors, invalid offsets, digest changes, gaps, and overlaps.
- Confirm that artifact content is absent from logs, telemetry attributes, snapshots, and push events.

### Web UI

- Render optional hover/focus metadata without fetching artifact bodies.
- Open the panel from mouse, keyboard, and touch/tablet interactions.
- Restore focus and cancel requests on close.
- Present consumed, failed, delivery-uncertain, legacy, loading, empty, and error states accurately.
- Load section pages lazily and keep bodies out of persisted client state.
- Export all four scope/format combinations and reject corrupt chunk streams.
- Verify that the frozen web-phone presentation remains unchanged.

### End-to-end verification

- Create a real handoff whose complete artifact fits without trimming and compare persisted, sent,
  displayed, and exported digests.
- Create a handoff that requires trimming and verify that sent and complete views differ exactly as
  reported.
- Reload the application and confirm the divider, detail panel, and exports remain stable.
- Exercise direct browser and hosted relay transports to confirm identical authorization and chunk
  behavior.

## Rollout and Compatibility

The delivery artifact and activity summary are additive and optional. Existing handoffs remain
valid, keep their current divider presentation, and gain complete-artifact inspection when their
stored structured context is valid. Their sent scope remains explicitly unavailable.

No background backfill is performed. Newly prepared handoffs persist the delivery artifact before
provider delivery. If that persistence fails, the handoff fails before delivery rather than sending
an unauditable payload.

The feature can ship with the panel and complete-artifact export enabled for legacy records while
exact sent inspection naturally becomes available only for new handoffs. No protocol negotiation
with provider drivers is required because persistence occurs around the existing provider input.

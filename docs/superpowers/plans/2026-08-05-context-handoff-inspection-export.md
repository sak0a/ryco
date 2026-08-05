# Context handoff inspection and export implementation plan

**Goal:** Make context handoffs inspectable from their timeline divider and exportable as
deterministic Markdown or JSON, while preserving the exact provider input before delivery and
keeping artifact bodies out of normal synchronization, caches, telemetry, and persistent client
state.

**Design spec:**
`docs/superpowers/specs/2026-08-05-context-handoff-inspection-export-design.md`

**Depends on:**
`docs/superpowers/plans/2026-08-04-context-handoff.md`

## Execution rules

- Read the approved design spec, this plan, repository `AGENTS.md`, and each referenced existing
  file before editing it.
- Preserve the approved distinction between the complete canonical artifact and the exact rendered
  payload. Never reconstruct or relabel an old payload as exact.
- Persist the immutable delivery artifact after rendering and before the first provider-delivery
  operation. If persistence fails, fail the handoff before provider delivery.
- Keep context bodies, exact user messages, raw payloads, and export bytes out of activities, shell
  snapshots, push streams, logs, spans, analytics, diagnostics, service-worker caches, browser
  persistence, and global/query-cached client state.
- Revalidate access for every summary, section-page, raw-chunk, and export-chunk request. A
  cross-thread or unauthorized handoff must look the same as an unknown handoff.
- Bound every body-bearing response by encoded bytes, not only by item count. Bind cursors and
  offsets to immutable artifact digests.
- Keep the divider compact. Hover and focus show metadata only; click or keyboard activation opens
  the inspector. Do not add message content or export actions to the tooltip.
- Keep `apps/web`'s frozen phone presentation unchanged. This plan covers supported web desktop and
  tablet/touch surfaces only; it does not add native mobile UI.
- Add focused tests with each slice. Never run `bun test`; always use `bun run test`.
- Use `apply_patch` for manual edits, preserve unrelated work, inspect the full diff, and run
  `git diff --check` before handoff.

## Dependency order

Complete Tasks 0–3 in order: they freeze the public contract, storage shape, and exact-delivery
invariant. Tasks 4–6 then build deterministic formatting, bounded reads, authorization, and RPC
wiring. Tasks 7–10 add ephemeral web data flow and the approved interaction. Finish with the
cross-layer privacy audit and full backstop in Tasks 11–12.

Do not begin UI body rendering against provisional response shapes. Do not wire body-bearing RPCs
until repository reads and authorization behavior have focused server tests.

## Task 0: Preflight and baseline

**Files:** read-only inspection across the repository.

- [ ] Confirm the worktree is clean or record every pre-existing change.
- [ ] Confirm the Bun version pinned in `package.json` and run `bun install --frozen-lockfile`.
- [ ] Re-read the approved design and current context-handoff implementation, especially:
  - [ ] `apps/server/src/orchestration/contextHandoff/ContextHandoffBuilder.ts`;
  - [ ] `apps/server/src/orchestration/contextHandoff/ContextHandoffRenderer.ts`;
  - [ ] `apps/server/src/orchestration/Services/ContextHandoffCoordinator.ts`;
  - [ ] `apps/server/src/persistence/Services/ContextHandoffs.ts`;
  - [ ] `apps/server/src/persistence/Layers/ContextHandoffs.ts`;
  - [ ] `apps/server/src/ws/orchestrationRpc.ts`;
  - [ ] `apps/web/src/components/chat/ContextHandoffMarkerRow.tsx`;
  - [ ] `apps/web/src/components/chat/MessagesTimeline.tsx`.
- [ ] Run focused existing context-handoff contract, persistence, builder, renderer, coordinator,
      timeline, and browser-component tests before edits.
- [ ] Record any baseline failures without changing unrelated code.
- [ ] Reconfirm migration `042` is the latest registered migration and reserve `043` for this
      feature.

## Task 1: Freeze inspection and delivery contracts

**Files:**

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/orchestration.test.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/rpc.test.ts`
- `packages/contracts/src/ipc.ts`
- new `apps/server/src/orchestration/contextHandoff/ContextHandoffArtifacts.ts`
- new `apps/server/src/orchestration/contextHandoff/ContextHandoffArtifacts.test.ts`
- `apps/server/src/orchestration/contextHandoff/ContextHandoffRenderer.ts`
- `apps/server/src/orchestration/contextHandoff/ContextHandoffRenderer.test.ts`

### 1.1 Immutable artifact schemas

- [ ] Move the schema-backed rendered context document and delivery artifact into the focused
      `ContextHandoffArtifacts.ts` module rather than leaving `RenderedDocument` as an unchecked
      private renderer interface or making persistence depend on renderer implementation details.
- [ ] Define a versioned `ContextHandoffDeliveryArtifact` there with:
  - [ ] artifact schema version and renderer/envelope version;
  - [ ] rendered structured context;
  - [ ] exact provider input string, including the triggering message;
  - [ ] the triggering message ID and exact text as a separate typed field, so readable inspection
        and Markdown never need to parse the provider envelope;
  - [ ] rendered-context SHA-256 digest and provider-input SHA-256 digest;
  - [ ] included and total entry counts;
  - [ ] rendered-context and provider-input character counts;
  - [ ] truncation flag and preparation timestamp.
- [ ] Keep the complete artifact's existing context version and digest meaning unchanged.
- [ ] Centralize digest validation and version constants. Do not duplicate hexadecimal digest
      schemas or magic version numbers across persistence, RPC, and UI modules.
- [ ] Extend the renderer result with the typed rendered document and both digests while preserving
      the existing exact `providerInput` behavior.
- [ ] Decode persisted artifacts through schemas at the service boundary; malformed stored JSON
      must produce a bounded domain error instead of leaking parser detail.

### 1.2 Inspection RPC contract

- [ ] Add bounded enums/schemas for:
  - [ ] scope: `sent | complete`;
  - [ ] section: messages, plans, tools, checkpoints, notices, subagents, prior handoffs, plus a
        sent-only triggering-message section that is not counted as a context entry;
  - [ ] export format: `markdown | json`;
  - [ ] scope availability and unavailable reason;
  - [ ] terminal delivery presentation status;
  - [ ] opaque cursor, byte offset, section counts, byte sizes, digests, and filenames.
- [ ] Define four read methods using the approved names:
  - [ ] `contextHandoff.getInspectionSummary`;
  - [ ] `contextHandoff.listInspectionEntries`;
  - [ ] `contextHandoff.readRawPayloadChunk`;
  - [ ] `contextHandoff.readExportChunk`.
- [ ] Require `threadId` and `handoffId` on every method, even when a handoff ID is globally unique.
- [ ] Make summary output metadata-only. It may include section indexes and counts but no message,
      command, output, path, or raw-payload content.
- [ ] Use a shared not-found-style error for unknown, cross-thread, and unauthorized handoffs. Add
      bounded validation/internal errors without embedding artifact excerpts.
- [ ] Put conservative hard maxima in the contract/server boundary for requested page size and
      returned UTF-8 bytes. Keep the limits independent of client hints.
- [ ] Register the RPC declarations in `WsRpcGroup` and protocol exports without changing existing
      orchestration method names.
- [ ] Add the four reads as a focused `contextHandoff` group on `EnvironmentApi`; do not overload the
      command-oriented orchestration surface or add desktop-only IPC methods.

### 1.3 Optional timeline metadata

- [ ] Extend terminal `ContextHandoffActivityPayload` variants with an optional bounded inspection
      summary containing:
  - [ ] complete entry count;
  - [ ] rendered included entry count and truncation flag when available;
  - [ ] complete-context and exact provider-input digests when available;
  - [ ] prepared and accepted timestamps when available.
- [ ] Keep every new activity field optional so historical events and snapshots decode unchanged.
- [ ] Confirm the activity schema cannot contain structured context, provider input, triggering
      message text, section entries, or export bytes.

### 1.4 Contract tests

- [ ] Round-trip every scope, format, section, availability, status, page, and chunk shape.
- [ ] Reject negative offsets, malformed digests/cursors, oversized limits, invalid filenames, and
      illegal section names.
- [ ] Decode old activities with no inspection metadata.
- [ ] Verify the summary schema rejects accidental body fields where exact schemas are expected.
- [ ] Snapshot exact renderer input, rendered JSON, counts, sizes, and both digests.

**Checkpoint:** focused contract/renderer tests, `bun typecheck`, and
`bun run typecheck:effect` pass.

## Task 2: Migrate and extend handoff persistence

**Files:**

- new `apps/server/src/persistence/Migrations/043_ContextHandoffDeliveryArtifact.ts`
- new `apps/server/src/persistence/Migrations/043_ContextHandoffDeliveryArtifact.test.ts`
- `apps/server/src/persistence/Migrations.ts`
- `apps/server/src/persistence/Services/ContextHandoffs.ts`
- `apps/server/src/persistence/Layers/ContextHandoffs.ts`
- `apps/server/src/persistence/Layers/ContextHandoffs.test.ts`

### 2.1 Additive migration

- [ ] Add a nullable delivery-artifact JSON column to `provider_context_handoffs`; do not rewrite or
      backfill existing rows.
- [ ] If the repository's SQLite compatibility policy requires separate metadata columns for
      querying, keep body-bearing data in the single immutable JSON artifact and document every
      added column. Do not normalize message/tool bodies into queryable tables.
- [ ] Register migration `043` and add fresh-database plus upgrade-from-`042` tests.
- [ ] Verify old rows retain their original structured context and decode with a null delivery
      artifact.

### 2.2 Repository operations

- [ ] Extend `ContextHandoffRecord` and every SELECT/INSERT/row decoder to round-trip the nullable
      delivery artifact.
- [ ] Add `storeDeliveryArtifactIfEmpty` with compare-and-set semantics. It must distinguish
      stored, already-identical, conflicting-existing, and missing-handoff outcomes.
- [ ] Never overwrite an existing delivery artifact, even during retry or recovery.
- [ ] When a retry produces the same artifact, return the stored immutable value and continue. When
      bytes/digests differ, fail closed before delivery.
- [ ] Keep existing `storeContextIfEmpty` semantics unchanged for the complete artifact.
- [ ] Add focused tests for:
  - [ ] first store and read after database reopen;
  - [ ] identical retry;
  - [ ] conflicting retry;
  - [ ] concurrent stores with one winner;
  - [ ] malformed persisted JSON on read;
  - [ ] legacy null delivery artifact;
  - [ ] no partial row mutation on failure.

**Checkpoint:** migration and repository tests pass against both new and upgraded databases.

## Task 3: Persist the exact payload before provider delivery

**Files:**

- `apps/server/src/orchestration/contextHandoff/ContextHandoffRenderer.ts`
- `apps/server/src/orchestration/contextHandoff/ContextHandoffRenderer.test.ts`
- `apps/server/src/orchestration/contextHandoff/ContextHandoffService.ts`
- `apps/server/src/orchestration/contextHandoff/ContextHandoffService.test.ts`
- `apps/server/src/orchestration/Services/ContextHandoffCoordinator.ts`
- `apps/server/src/orchestration/Layers/ContextHandoffCoordinator.ts`
- `apps/server/src/orchestration/Layers/ContextHandoffCoordinator.test.ts`

### 3.1 Render once and create the delivery artifact

- [ ] Build the delivery artifact from the exact renderer result used for dispatch; do not call the
      renderer a second time for persistence.
- [ ] Hash canonical rendered-context bytes and exact provider-input UTF-8 bytes.
- [ ] Keep the canonical triggering user message out of rendered structured context and append it to
      exact provider input exactly as current delivery behavior does.
- [ ] Store that same immutable message ID/text as the delivery artifact's separate triggering
      message field and prove it is the exact string passed to the envelope renderer.
- [ ] Validate the delivery artifact before attempting to store it.

### 3.2 Enforce persistence ordering

- [ ] In the coordinator, preserve this order:
  1. load or build and persist the complete artifact;
  2. render the provider input once;
  3. persist the delivery artifact immutably;
  4. transition/continue dispatch;
  5. invoke the provider-delivery path.
- [ ] Add a test spy/barrier proving the repository store completes before any provider start/send
      call observes the payload.
- [ ] If artifact persistence fails or conflicts, transition to a truthful failed state and never
      call provider delivery.
- [ ] Preserve the artifact when provider start/send later fails so the UI can label it “Prepared
      payload, not accepted.”
- [ ] Preserve it for delivery-uncertain recovery so the UI can label it “Attempted payload;
      delivery uncertain.”
- [ ] Do not change normal same-provider/model turns.

### 3.3 Publish bounded terminal metadata

- [ ] Populate the optional inspection summary only on terminal activity updates for which the facts
      are known.
- [ ] Derive counts/digests/timestamps from the stored artifacts and accepted transition, not from
      client input.
- [ ] Ensure failed-before-rendering activities contain no invented sent counts or provider-input
      digest.
- [ ] Add tests for consumed, failed-before-render, failed-after-render, delivery-uncertain, retry,
      and legacy activity payloads.

**Checkpoint:** renderer, service, coordinator, and recovery tests prove that no unauditable payload
can be delivered.

## Task 4: Build deterministic inspection and export formatting

**Files:**

- new `apps/server/src/orchestration/contextHandoff/ContextHandoffInspection.ts`
- new `apps/server/src/orchestration/contextHandoff/ContextHandoffInspection.test.ts`
- new `apps/server/src/orchestration/contextHandoff/ContextHandoffMarkdown.ts`
- new `apps/server/src/orchestration/contextHandoff/ContextHandoffMarkdown.test.ts`
- `apps/server/src/orchestration/contextHandoff/ContextHandoffBuilder.ts`
- `apps/server/src/orchestration/contextHandoff/ContextHandoffBuilder.test.ts`

### 4.1 Shared immutable projections

- [ ] Extract reusable section order, section lookup, chronological comparison, entry counting, and
      stable canonical JSON helpers instead of duplicating renderer logic.
- [ ] Project `sent` from the stored rendered document and `complete` from the stored canonical
      document. Never parse the XML-like provider envelope to recover sent entries.
- [ ] Treat the exact sent raw scope as the stored provider-input string.
- [ ] Treat the complete raw scope as the stable canonical JSON of the complete document. Keep the
      complete JSON export's integrity wrapper separate from raw-scope bytes.
- [ ] Produce metadata-only section indexes without retaining extra copies of large bodies.

### 4.2 Deterministic formats

- [ ] Define an explicit export-format version included in generated output/cache keys.
- [ ] Generate sent JSON from the immutable delivery artifact, including exact provider input and
      structured rendered context.
- [ ] Generate complete JSON from the canonical document plus integrity/provenance metadata.
- [ ] Generate Markdown in the fixed approved section order, omitting empty sections.
- [ ] Put metadata, scope, status, provenance, truncation, counts, and digest before content.
- [ ] For sent Markdown only, append the triggering user message in a clearly labeled final
      section because it was part of provider input.
- [ ] Fence and escape arbitrary backticks, commands, outputs, paths, XML-like text, Unicode, and
      control characters without changing the represented content.
- [ ] Sanitize and stabilize filenames as
      `ryco-context-handoff-<handoff-id>-<sent|complete>.<md|json>`.
- [ ] Verify byte-for-byte determinism across repeated generation and after simulated cache
      eviction/server restart.

### 4.3 Status truthfulness

- [ ] Centralize display semantics:
  - [ ] consumed: “Sent to model”;
  - [ ] failed before render: “Prepared, not sent” and sent unavailable;
  - [ ] failed after render: “Prepared payload, not accepted”;
  - [ ] delivery uncertain: “Attempted payload; delivery uncertain”;
  - [ ] legacy null delivery artifact: “Exact sent payload unavailable for this handoff.”
- [ ] Do not infer delivery from the existence of the delivery artifact alone.
- [ ] Test full, trimmed, compacted-entry, empty-section, failed, uncertain, and legacy documents.

**Checkpoint:** formatting tests prove deterministic bytes, correct scope boundaries, safe Markdown,
and truthful status labels.

## Task 5: Add bounded inspection service and pagination

**Files:**

- new `apps/server/src/orchestration/Services/ContextHandoffInspection.ts`
- new `apps/server/src/orchestration/Layers/ContextHandoffInspection.ts`
- new `apps/server/src/orchestration/Layers/ContextHandoffInspection.test.ts`
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts`
- `apps/server/src/orchestration/runtimeLayer.ts`
- `apps/server/src/server.ts`

### 5.1 Authorized lookup

- [ ] Make every operation accept both thread and handoff IDs.
- [ ] Resolve the requested thread through the existing projection/read model and reject deleted or
      unreadable threads according to existing RPC policy.
- [ ] Load the handoff and require `record.threadId === input.threadId` before decoding or returning
      artifact metadata.
- [ ] Collapse unknown thread, unknown handoff, mismatched thread, and unauthorized access into the
      same not-found-style public error.
- [ ] Do not include IDs, paths, body excerpts, parse details, or SQL text in public/internal log
      fields beyond existing safe identifiers policy.

### 5.2 Summary and section pages

- [ ] Return metadata-only inspection summaries, including per-scope availability, counts, byte
      sizes, digests, section indexes, timestamps, and unavailable reason.
- [ ] Generate opaque integrity-protected cursors bound to handoff ID, thread ID, scope, section,
      immutable digest, and next logical position.
- [ ] Enforce both maximum entries and maximum encoded response bytes. Configure the byte cap to fit
      one maximally schema-bounded entry; reject corrupt historical entries outside those bounds
      rather than truncating inspected content or exceeding the response cap.
- [ ] Reject a cursor for a different artifact, section, scope, or digest.
- [ ] Preserve stable ordering across pages and database reopen.

### 5.3 Raw and export chunks

- [ ] Convert selected immutable content to UTF-8 and slice only at valid byte boundaries while
      returning exact offset, total bytes, digest, and next offset.
- [ ] Require strictly valid offsets within the selected immutable byte stream.
- [ ] Use a bounded chunk maximum controlled by the server.
- [ ] Generate export bytes deterministically from Task 4. A small bounded TTL cache is optional;
      correctness must not depend on cache retention.
- [ ] Key cached export bytes by handoff/digest, scope, format, and export-format version; cap entry
      count and total cache bytes.
- [ ] Add tests for empty/final chunks, Unicode boundaries, invalid offsets, stale cursors, byte
      limits, cache eviction, digest stability, and cancellation.

### 5.4 Memory and concurrency limits

- [ ] Avoid unbounded duplicate serialization for concurrent reads of a large artifact.
- [ ] Derive and document an explicit maximum complete-artifact/export size from encoded persisted
      JSON and per-entry bounds. Enforce it consistently when building new artifacts and when
      decoding historical rows so Ryco never creates an artifact the inspector cannot safely read.
- [ ] Ensure cancelled request effects release generated buffers and do not mutate handoff state.

**Checkpoint:** service tests cover authorization equivalence, pagination invariants, deterministic
regeneration, byte limits, and cancellation.

## Task 6: Wire authenticated RPC handlers and access policy

**Files:**

- new `apps/server/src/ws/contextHandoffRpc.ts`
- new `apps/server/src/ws/contextHandoffRpc.test.ts`
- `apps/server/src/ws/context.ts`
- `apps/server/src/ws/index.ts`
- `apps/server/src/ws/RpcAccessPolicy.ts`
- `apps/server/src/ws/RpcAccessPolicy.test.ts`
- `apps/server/src/ws/authRpcRegression.test.ts`
- relevant server RPC handler tests

- [ ] Provide the inspection service through the existing server layer graph.
- [ ] Add a focused handler group for all four RPC methods using existing effect/error observation
      conventions; do not grow `orchestrationRpc.ts` with a separate inspection domain.
- [ ] Classify the methods as authenticated read operations available to the same viewer role as
      thread reads; do not grant mutation authority.
- [ ] Keep thread/handoff authorization in the service so no transport can bypass it.
- [ ] Audit `observeRpcEffect` and related performance/error helpers. Record only operation name,
      scope/format, status, bounded counts, byte totals, and duration—never response payloads,
      cursors containing content, or error causes containing content.
- [ ] Add regression tests for owner/viewer access, anonymous denial, cross-thread IDs,
      unauthorized/unknown equivalence, hosted/direct transport parity at the handler boundary, and
      abort propagation.
- [ ] Confirm none of these methods enter service-worker routing or cacheable HTTP paths.

**Checkpoint:** RPC/access-policy tests pass and a response-body/logging audit finds no content
capture.

## Task 7: Add ephemeral web inspection transport

**Files:**

- new `apps/web/src/context-handoff/inspection.ts`
- new `apps/web/src/context-handoff/inspection.test.ts`
- new `apps/web/src/context-handoff/export.ts`
- new `apps/web/src/context-handoff/export.test.ts`
- `packages/client-runtime/src/rpc/wsRpcClient.ts`
- `packages/client-runtime/src/rpc/wsRpcClient.test.ts`
- `packages/client-runtime/src/connection/environmentApi.ts`
- new `packages/client-runtime/src/connection/environmentApi.test.ts`
- `apps/web/src/environmentApi.ts`

### 7.1 Abortable panel session

- [ ] Expose the four typed methods as `WsRpcClient.contextHandoff` and map them through the
      environment-bound `EnvironmentApi.contextHandoff` surface so direct, desktop, and hosted
      connections use identical routing.
- [ ] Create a panel-local controller/hook that loads summary and section pages through the typed
      RPC client.
- [ ] Keep summary, pages, raw chunks, export chunks, and errors in component-owned ephemeral state.
      Do not write them to Jotai global atoms, TanStack/query caches, local/session storage,
      IndexedDB, persisted thread state, or service-worker messages.
- [ ] Associate every response with the active handoff ID and request generation; ignore stale
      completions after switching markers or closing the panel.
- [ ] Require every section page's artifact digest to match the active summary before committing
      entries to visible state.
- [ ] Abort all outstanding requests and release accumulated byte chunks on close/unmount.
- [ ] Support independent retry for summary, section page, raw view, and export.

### 7.2 Verified chunk assembly

- [ ] Request raw/export offsets sequentially and reject gaps, overlaps, duplicate offsets,
      reordered chunks, total-size changes, digest changes, filename changes, and non-advancing next
      offsets.
- [ ] Assemble a Blob only after the final chunk and verify SHA-256 with Web Crypto before displaying
      raw content as verified or starting a download.
- [ ] Fail closed on digest mismatch, clear accumulated bytes, and offer a clean restart from offset
      zero.
- [ ] Revoke every object URL after download initiation or cancellation.
- [ ] Test empty, single-chunk, multi-chunk, Unicode, abort, corrupt digest, gap, overlap, stale
      generation, and retry cases.

**Checkpoint:** focused web logic tests prove no durable state writes and strict chunk validation.

## Task 8: Make the divider an accessible inspection trigger

**Files:**

- `apps/web/src/session-logic.ts`
- session/timeline logic tests and fixtures
- `apps/web/src/components/chat/ContextHandoffMarkerRow.tsx`
- new `apps/web/src/components/chat/ContextHandoffMarkerRow.test.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/chat/MessagesTimeline.test.tsx`
- `apps/web/src/components/ui/tooltip.tsx` only if the shared primitive needs a compatible fix

- [ ] Parse optional inspection metadata into `ContextHandoffTimelineEntry` without making old
      activities invalid.
- [ ] Render the existing divider as a semantic button while retaining its compact boundary-first
      appearance and picker-friendly provider/model labels.
- [ ] Add a descriptive accessible name containing source, target, and terminal status.
- [ ] On hover and focus, show metadata only:
  - [ ] source and target presentation;
  - [ ] delivery status and timestamp;
  - [ ] included versus total entries when known;
  - [ ] whether the payload was trimmed.
- [ ] Do not fetch inspection data merely because the divider hovered or focused.
- [ ] Do not put messages, commands, paths, digests, or export actions in the tooltip.
- [ ] Expose an `onInspect` callback through the timeline with the marker/handoff identity and
      originating button reference for focus restoration.
- [ ] Ensure Enter and Space activate the inspector and touch activation does not depend on hover.
- [ ] Preserve a non-interactive/readable legacy divider if inspection is unavailable due to client
      capability, while allowing complete-scope inspection for valid legacy server records once the
      panel opens.
- [ ] Test mouse, keyboard, focus tooltip, touch/click, absent metadata, failed/uncertain statuses,
      accessible labeling, and zero body-fetch-on-hover behavior.

**Checkpoint:** marker/timeline unit and component tests pass with historical activity fixtures.

## Task 9: Build the right-panel/sheet inspector

**Files:**

- new `apps/web/src/components/chat/ContextHandoffInspectionPanel.tsx`
- new `apps/web/src/components/chat/ContextHandoffInspectionPanel.test.tsx`
- new `apps/web/src/components/chat/ContextHandoffInspectionSection.tsx`
- new `apps/web/src/components/chat/ContextHandoffRawPayload.tsx`
- `apps/web/src/components/chat/ContextHandoffEndpointLabel.tsx`
- `apps/web/src/components/RightPanelSheet.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/ChatView.logic.ts`
- corresponding ChatView unit/browser tests

### 9.1 Presentation and lifecycle

- [ ] Own selected-handoff and inspector-open state beside the chat/timeline surface, not in routing
      or global application state.
- [ ] Open as the existing right-side panel pattern on desktop and the existing sheet pattern on
      supported tablet/touch presentation tiers.
- [ ] Do not mount or extend the inspector in the frozen web-phone tier.
- [ ] Move focus into the panel after open, close with Escape, and restore focus to the exact divider
      that opened it.
- [ ] Closing clears all loaded body state and aborts requests without changing thread/model/session
      state or mutation readiness.

### 9.2 Header and scope controls

- [ ] Reuse provider icons and picker-friendly endpoint labels for source lineage and target.
- [ ] Show terminal status, creation/preparation/acceptance times when available, and a collapsed
      integrity region for complete-context and exact provider-input digests.
- [ ] Default to `Sent to model` only when consumed and the exact sent scope exists; otherwise select
      the available scope and explain why sent is unavailable.
- [ ] Offer `Sent to model` and `Complete artifact` as accessible scope controls. Selection governs
      preview, raw view, and exports together.
- [ ] When sent differs from complete, show omitted-entry count and input-budget trimming language;
      never call either artifact a summary.

### 9.3 Readable and raw views

- [ ] Default to a readable structured view with the approved fixed section order and section
      counts.
- [ ] In sent scope, show the triggering user message as a separate final read-only section. Do not
      count it as a handoff-context entry or include it in complete scope.
- [ ] Load a section's first page only when the disclosure opens; append subsequent pages on an
      explicit load-more action or bounded progressive behavior.
- [ ] Reuse existing message/code/path/status primitives where they preserve exact content and do
      not introduce hidden persistence.
- [ ] Render large strings safely with wrapping/scrolling and no `dangerouslySetInnerHTML`.
- [ ] Make `Raw payload` a secondary on-demand view. Do not download raw chunks until selected.
- [ ] Display loading, empty, retryable-error, digest-mismatch, legacy, failed-before-render,
      failed-after-render, delivery-uncertain, and cancellation states with the exact approved
      semantics.
- [ ] Add semantic headings/landmarks and keyboard-operable disclosures.

**Checkpoint:** component tests cover scope defaults, lazy section loading, focus lifecycle, all
status states, cleanup, and the frozen phone boundary.

## Task 10: Add verified export UX

**Files:**

- new `apps/web/src/components/chat/ContextHandoffExportMenu.tsx`
- new `apps/web/src/components/chat/ContextHandoffExportMenu.test.tsx`
- `apps/web/src/components/chat/ContextHandoffInspectionPanel.tsx`
- `apps/web/src/context-handoff/export.ts`
- relevant browser tests

- [ ] Add an export menu for the active scope with `Readable Markdown` and `Structured JSON`.
- [ ] Show the approved concise sensitivity notice before the actions; do not add a confirmation
      modal.
- [ ] Disable only the unavailable scope/format and keep the other scope usable.
- [ ] Show progress and cancellation for multi-chunk exports without retaining chunks after finish,
      failure, close, or cancel.
- [ ] Start download only after offset-stream and final SHA-256 validation succeeds.
- [ ] Use the server-provided sanitized filename but defensively reject path separators, control
      characters, unexpected extensions, or scope/format mismatches client-side.
- [ ] Test all four combinations: sent Markdown, sent JSON, complete Markdown, complete JSON.
- [ ] Test cancellation, RPC retry, digest mismatch, bad filename, large multi-chunk export, URL
      revocation, and panel close during export.

**Checkpoint:** export logic/component tests pass and no corrupt or partially verified file can be
downloaded.

## Task 11: Cross-layer browser, privacy, and compatibility verification

**Files:**

- `apps/web/src/components/chat/MessagesTimeline.browser.tsx`
- `apps/web/src/components/ChatView.browser.tsx`
- browser fixtures/helpers used by context-handoff tests
- `apps/web/public/sw.js` or the current service-worker source, read-only unless an actual route bug
  is found
- `dogfood-output/context-handoff-inspection/` for local QA evidence only

### 11.1 Browser component suite

- [ ] Verify hover/focus tooltip metadata without a body request.
- [ ] Open from mouse, keyboard, and touch/tablet interaction.
- [ ] Verify focus moves into the inspector and returns to the originating divider.
- [ ] Lazily load multiple section pages and switch scopes without leaking stale results.
- [ ] Exercise readable/raw switching and all four export combinations.
- [ ] Verify failed, delivery-uncertain, legacy, loading, empty, retry, cancellation, and digest-error
      presentations.
- [ ] Verify the frozen phone presentation has no new context-handoff inspector UI.

### 11.2 Real handoff scenarios

- [ ] Start the web development server and use headed `agent-browser` QA in Chrome/Brave.
- [ ] Create a handoff that fits without trimming and compare persisted, displayed, raw, and exported
      digests/bytes.
- [ ] Create or fixture a handoff that requires trimming and verify sent and complete views differ by
      exactly the reported counts.
- [ ] Reload the app and confirm the divider, status, inspector, and exports remain stable.
- [ ] Verify a legacy record exposes complete scope and explicitly refuses exact sent scope.
- [ ] Capture concise screenshots and a Markdown QA report without including sensitive context in
      the committed repository.

### 11.3 Privacy/transport audit

- [ ] Search shell snapshots, thread push payloads, activities, logs, observability helpers,
      diagnostics, analytics, local/session storage, IndexedDB, and service-worker caches for new
      artifact fields and exact body content.
- [ ] Confirm inspection requests stay on the authenticated RPC transport for direct, desktop, and
      hosted relay connections.
- [ ] Confirm no public URL, bearer credential, request-body cache, or shareable download endpoint is
      introduced.
- [ ] Confirm body-bearing errors and aborted requests do not report artifact excerpts.
- [ ] Add regression tests for any boundary that was not mechanically guaranteed by types.

**Checkpoint:** browser automation and manual headed inspection match the approved design and leave
no artifact body in persistent client or observability surfaces.

## Task 12: Full repository backstop and handoff

- [ ] Run focused changed-package tests after the final integration diff.
- [ ] Run `git diff --check` and inspect the full diff for accidental generated files, context data,
      debug logs, unrelated formatting, and private environment evidence.
- [ ] Run the repository-required backstop in order:

  ```sh
  bun fmt
  bun run fmt:check
  bun lint
  bun typecheck
  bun run typecheck:effect
  bun run test
  bun run build
  ```

- [ ] Build and test the web package:

  ```sh
  bun run build --filter=@ryco/web
  bun run --cwd apps/web test:browser
  ```

- [ ] If the pinned Playwright runtime is absent, install it first with:

  ```sh
  bun run --cwd apps/web test:browser:install
  ```

- [ ] Run `bun run build:desktop` only if Electron/desktop pipeline files changed.
- [ ] Do not run `bun run release:smoke` unless release-workflow files changed.
- [ ] Re-run headed agent-browser smoke QA against the final build or dev server.
- [ ] Summarize implementation, schema/migration impact, legacy behavior, security boundaries, tests,
      QA evidence, and any remaining limitations in the final handoff.

## Final acceptance criteria

- [ ] Activating a handoff divider opens the approved desktop panel or tablet/touch sheet; hover and
      focus reveal metadata only.
- [ ] Newly rendered provider input is stored immutably before any provider-delivery call.
- [ ] Consumed handoffs show the exact sent scope by default; complete scope remains distinct.
- [ ] Failed, uncertain, and legacy records never overstate delivery or exact-payload availability.
- [ ] Readable views use deterministic typed artifacts; raw sent view is the stored exact provider
      input, not a reconstruction.
- [ ] Sent/complete Markdown and JSON exports are deterministic, bounded, chunk-verified, and
      digest-checked before download.
- [ ] Every body read revalidates thread/handoff access and unauthorized IDs are not enumerable.
- [ ] Artifact bodies do not enter normal synchronization, logs, telemetry, caches, or persistent
      client state.
- [ ] Closing the inspector cancels reads, releases bytes, and restores focus without affecting chat
      state.
- [ ] Historical handoffs retain complete-artifact access and clearly report exact sent payload as
      unavailable.
- [ ] The frozen web-phone tier and native mobile app are unchanged.
- [ ] All focused, repository, build, browser, and headed QA checks pass.

# Provider-Neutral Subagents for Ryco

## Summary

Add subagent support in two tracks:

- **Native provider subagents:** first-class observation for OpenCode and Claude, with Cursor/ACP summary fallback and existing Codex behavior preserved.
- **Ryco-managed subagents:** explicit read-only child threads launched from Ryco, hidden from the normal sidebar and shown nested under the parent thread.

Defaults chosen:

- First shippable milestone: **OpenCode + Claude native support**.
- Managed subagents: **read-only first**, explicit picker, nested-only visibility.
- Providers without child transcripts: **summary tab fallback**.
- No polling; use provider/runtime events plus one-time hydration on reconnect.

## Public API And Schema Changes

### `packages/contracts/src/baseSchemas.ts`

Add:

```ts
export const RuntimeSubagentId = makeEntityId("RuntimeSubagentId");
export type RuntimeSubagentId = typeof RuntimeSubagentId.Type;
```

### `packages/contracts/src/providerRuntime.ts`

Add canonical provider-runtime subagent events:

```ts
RuntimeSubagentOrigin = "provider-native" | "ryco-managed";
RuntimeSubagentCapability = "summary" | "thread";
RuntimeSubagentStatus = "running" | "waiting" | "idle" | "completed" | "failed" | "stopped";

SubagentRef = {
  subagentId: RuntimeSubagentId;
  origin: RuntimeSubagentOrigin;
  capability: RuntimeSubagentCapability;
  displayName?: string;
  role?: string;
  detail?: string;
  parentProviderThreadId?: string;
  providerThreadId?: string;
  providerItemId?: ProviderItemId;
  childThreadId?: ThreadId;
};

subagent.started   { subagent: SubagentRef; status: RuntimeSubagentStatus }
subagent.updated   { subagentId; status; summary?; usage?; lastToolName? }
subagent.completed { subagentId; status: "completed" | "failed" | "stopped"; summary?; usage? }
subagent.message.delta { subagentId; providerThreadId?; providerItemId?; delta; streamKind? }
```

Keep existing `task.*`, `item.*`, and Codex `collab_agent_tool_call` support for compatibility.

### `packages/contracts/src/orchestration.ts`

Add thread nesting fields:

```ts
ThreadKind = "normal" | "managed-subagent";
ThreadVisibility = "normal" | "nested";
```

Extend `ThreadCreateCommand`, `ThreadCreatedPayload`, and `OrchestrationThread` with defaults:

```ts
threadKind: ThreadKind = "normal";
visibility: ThreadVisibility = "normal";
parentThreadId: ThreadId | null = null;
parentSubagentId: RuntimeSubagentId | null = null;
```

Add client command:

```ts
thread.managed-subagents.launch {
  commandId;
  parentThreadId;
  workers: Array<{
    subagentId;
    threadId;
    title;
    prompt;
    modelSelection?: ModelSelection; // default: parent thread modelSelection
  }>;
  createdAt;
}
```

Validation: 1-4 workers per launch, parent must exist and not be deleted, parent must be `threadKind: "normal"`, all child `threadId` values must be absent.

### `apps/server/src/provider/Services/ProviderAdapter.ts`

Extend `ProviderAdapterCapabilities`:

```ts
subagents: {
  native: {
    level: "none" | "summary" | "thread";
    canListChildren: boolean;
  }
  managed: {
    supported: boolean;
  }
}
```

Set defaults:

- Codex: `{ native.level: "thread", canListChildren: false, managed.supported: true }`
- OpenCode: `{ native.level: "thread", canListChildren: true, managed.supported: true }`
- Claude: `{ native.level: "summary", canListChildren: false, managed.supported: true }`
- Cursor: `{ native.level: "summary", canListChildren: false, managed.supported: true }`
- Copilot: `{ native.level: "none", canListChildren: false, managed.supported: true }`

## Implementation Phases

### Phase 1: Contract And Projection Foundation

1. Add schemas above.
2. Add SQLite migration columns to `projection_threads`:
   - `thread_kind TEXT NOT NULL DEFAULT 'normal'`
   - `visibility TEXT NOT NULL DEFAULT 'normal'`
   - `parent_thread_id TEXT`
   - `parent_subagent_id TEXT`
3. Update projection repositories, snapshot query, projector, store mapping, and sidebar selectors.
4. Filter normal thread lists to `visibility === "normal"`.
5. Keep nested threads in the client store so parent workspace panels can render their messages.

### Phase 2: Runtime Ingestion Normalization

1. Update `ProviderRuntimeIngestion.ts` to map new `subagent.*` events into parent `thread.activity.append` rows.
2. Activity payload shape:

```ts
{
  itemType: "subagent",
  subagent: SubagentRef,
  status,
  summary?,
  streaming?,
  text?,
}
```

3. Keep existing `collab_agent_tool_call` handling.
4. Update `threadWorkspaceViewModel.ts` to derive subagents from both `payload.subagent` and legacy `collab_agent_tool_call`.
5. Key managed subagents as `subagent:${subagentId}`.
6. Attach transcript messages from `subagent.message.delta` and from child Ryco thread messages when `childThreadId` exists.

### Phase 3: OpenCode Native Thread Subagents

Files:

- `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts`
- `apps/server/src/provider/opencodeRuntime.ts` if helper extraction is useful

Tasks:

1. Track `childSessionIdsByParentSessionId` and `subagentIdByChildSessionId`.
2. Stop filtering events to only the root `openCodeSessionId`; allow root plus known child session IDs.
3. Handle `session.created` where `info.parentID === rootSessionId`:
   - emit `subagent.started`
   - `capability: "thread"`
   - `providerThreadId: child session id`
4. On session start/reconnect, call `client.session.children({ sessionID })` once and hydrate child sessions.
5. Key `messageRoleById`, `partById`, and text buffers by `sessionID:id` to avoid child/root collisions.
6. Emit child assistant text as `subagent.message.delta`, not parent `content.delta`.
7. Map `subtask` parts to summary data while waiting for child `session.created`.

Acceptance:

- OpenCode child session appears as a subagent row/tab.
- Child transcript streams into the subagent tab.
- Root assistant text is unchanged.

### Phase 4: Claude Native Summary Subagents

Files:

- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`

Tasks:

1. Treat Claude `task_started`, `task_progress`, and `task_notification` as subagent summary events when `task_type`, tool name, or description indicates Agent/subagent work.
2. Use `claude-task:${task_id}` as `RuntimeSubagentId`.
3. Emit:
   - `subagent.started` on `task_started`
   - `subagent.updated` on `task_progress`
   - `subagent.completed` on `task_notification`
4. Preserve existing `task.*` events and `collab_agent_tool_call` classification.
5. No child transcript expected in this phase.

Acceptance:

- Claude Agent/Task work shows as a subagent with summary tab.
- Token usage from `task_progress` remains intact.

### Phase 5: Cursor ACP Summary Fallback

Files:

- `apps/server/src/provider/acp/AcpRuntimeModel.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/provider/acp/CursorAcpExtension.ts`

Tasks:

1. Map ACP `tool_call` / `tool_call_update` names containing `agent`, `subagent`, or `task` to summary-capability subagent events.
2. Use ACP tool call id as `RuntimeSubagentId`.
3. Keep `agent_message_chunk` as root assistant text unless Cursor provides child metadata.
4. Log Cursor extension payloads with unknown subagent-like fields for future upgrade, but do not depend on private fields.

Acceptance:

- Cursor can show subagent-like summary tabs from ACP tool calls.
- No false child transcript is fabricated.

### Phase 6: Ryco-Managed Read-Only Subagents

Files:

- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/decider.ts`
- new `apps/server/src/orchestration/Services/ManagedSubagentReactor.ts`
- new `apps/server/src/orchestration/Layers/ManagedSubagentReactor.ts`
- `apps/server/src/orchestration/runtimeLayer.ts`

Tasks:

1. Add `thread.managed-subagents.launch` command and event.
2. `ManagedSubagentReactor` listens for launch events.
3. For each worker:
   - dispatch `thread.create` with `threadKind: "managed-subagent"`, `visibility: "nested"`, `parentThreadId`, `parentSubagentId`
   - copy parent `projectId`, `branch`, `worktreePath`
   - use worker `modelSelection` or parent `modelSelection`
   - force `runtimeMode: "approval-required"`
4. Dispatch child `thread.turn.start` with read-only prompt prefix:

```text
You are a Ryco managed read-only subagent. Do not edit, create, delete, patch, move, or overwrite files. Do not run commands whose purpose is to modify repository state. Investigate the assigned task and return a concise summary with Findings, Evidence, Risks, and Suggested Next Steps.
```

5. Mirror child lifecycle into parent subagent activity.
6. Auto-decline file-change/apply-patch approvals for managed child threads.
7. Command execution approvals are not auto-approved.

Acceptance:

- Managed workers run as real child Ryco threads.
- They are hidden from the normal sidebar.
- Parent workspace shows each worker as a subagent tab.
- File edits are blocked by policy even for providers without a true sandbox.

### Phase 7: Explicit Launch UI

Files:

- `apps/web/src/components/ThreadWorkspacePanel.tsx`
- `apps/web/src/components/chat/useChatWorkspacePanels.ts`
- new `apps/web/src/components/ManagedSubagentLauncher.tsx`
- `apps/web/src/rpc/` command helpers if needed

UI:

- Add `Run subagents` action in the workspace launcher.
- Dialog supports 1-4 workers.
- Each worker row has:
  - name/title
  - prompt
  - provider/model selection defaulting to parent thread model
  - locked `Read-only` mode indicator
- Submit dispatches `thread.managed-subagents.launch`.
- On success, open the first launched subagent tab.

### Phase 8: Agent Thread Panel Enhancements

Files:

- `apps/web/src/components/ThreadWorkspacePanel.tsx`
- `apps/web/src/threadWorkspaceViewModel.ts`
- `apps/web/src/threadWorkspaceTabs.ts`

Tasks:

1. If `subagent.childThreadId` exists, render child thread messages in `AgentThreadPanel`.
2. If no child thread exists, render summary/activity fallback.
3. Show capability label internally via status text only when needed: transcript vs summary.
4. Closing a tab never stops provider-native or managed child work.

## Tests

Required focused tests:

- Contract schema decode/encode for new events and thread nesting defaults.
- Migration adds thread nesting columns and preserves old rows as normal visible threads.
- Projector maps `thread.created` nesting fields.
- Sidebar selectors hide `visibility: "nested"` threads.
- ProviderRuntimeIngestion maps `subagent.*` events to parent activities.
- OpenCode: child `session.created`, child text, root text isolation, reconnect hydration.
- Claude: `task_*` to summary subagent events plus existing task events.
- Cursor: ACP tool call fallback, no transcript fabrication.
- ManagedSubagentReactor: launch creates child threads, starts turns, mirrors status, rejects writes.
- Web view model: legacy Codex, OpenCode thread, Claude summary, Cursor summary, managed child thread.
- UI: launch dialog validation, first tab opens, summary fallback, child transcript rendering.

Use `bun run test` only. Do not use `bun test`.

## Verification

Before completion:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- Focused `bun run test ...` suites for changed modules
- Browser verification:
  - OpenCode native child transcript
  - Claude summary subagent tab
  - Cursor ACP summary fallback
  - managed read-only launch with 1 and 4 workers
  - nested child threads hidden from sidebar
  - subagent tab close/reopen
  - no text overlap in launcher, tab strip, or summary rows

## Suggested Subagent-Based Execution

When implementing, split work across coding subagents:

1. **Contracts/projection subagent:** schemas, migrations, projector, snapshot/store filtering.
2. **Provider-native subagent:** OpenCode and Claude adapter work.
3. **ACP fallback subagent:** Cursor ACP summary fallback and tests.
4. **Managed orchestration subagent:** launch command, reactor, read-only guards.
5. **Web UX subagent:** launcher, view model, AgentThreadPanel changes.
6. **QA subagent:** cross-provider fixtures, regression tests, verification commands.

Run these as isolated implementation tasks and merge through one coordinator to avoid conflicting edits.

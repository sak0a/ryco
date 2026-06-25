# Provider-Neutral Subagents for Ryco

## Summary

First-class observation of native provider subagents, normalized into a single
provider-neutral surface:

- **Native provider subagents:** first-class observation for OpenCode and Claude, with Cursor/ACP summary fallback and existing Codex behavior preserved.

Defaults chosen:

- First shippable milestone: **OpenCode + Claude native support**.
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
RuntimeSubagentOrigin = "native" | "inferred";
RuntimeSubagentCapability = "transcript" | "summary";
RuntimeSubagentStatus = "starting" | "running" | "completed" | "failed" | "stopped";

SubagentRef = {
  subagentId: RuntimeSubagentId;
  origin: RuntimeSubagentOrigin;
  capability: RuntimeSubagentCapability;
  label?: string;
  description?: string;
  providerSessionId?: string;
  providerThreadId?: string;
  providerTaskId?: RuntimeTaskId;
  parentProviderItemId?: ProviderItemId;
};

subagent.started   { subagent: SubagentRef; status: RuntimeSubagentStatus }
subagent.updated   { subagentId; status; summary?; usage?; lastToolName? }
subagent.completed { subagentId; status: "completed" | "failed" | "stopped"; summary?; usage? }
subagent.message.delta { subagentId; providerThreadId?; providerItemId?; delta; streamKind? }
```

Keep existing `task.*`, `item.*`, and Codex `collab_agent_tool_call` support for compatibility.

### `apps/server/src/provider/Services/ProviderAdapter.ts`

Extend `ProviderAdapterCapabilities`:

```ts
subagents: {
  native: {
    level: "none" | "summary" | "thread";
    canListChildren: boolean;
  }
}
```

Set defaults:

- Codex: `{ native.level: "thread", canListChildren: false }`
- OpenCode: `{ native.level: "thread", canListChildren: true }`
- Claude: `{ native.level: "summary", canListChildren: false }`
- Cursor: `{ native.level: "summary", canListChildren: false }`
- Copilot: `{ native.level: "none", canListChildren: false }`

## Implementation Phases

### Phase 1: Contract Foundation

1. Add the subagent event schemas above.

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
5. Key subagents as `subagent:${subagentId}`.
6. Attach transcript messages from `subagent.message.delta`.

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

### Phase 6: Agent Thread Panel Enhancements

Files:

- `apps/web/src/components/ThreadWorkspacePanel.tsx`
- `apps/web/src/threadWorkspaceViewModel.ts`
- `apps/web/src/threadWorkspaceTabs.ts`

Tasks:

1. Render subagent summary/activity in `AgentThreadPanel`, streaming transcript messages when available.
2. If no transcript exists, render the summary/activity fallback.
3. Show capability label internally via status text only when needed: transcript vs summary.
4. Closing a tab never stops provider-native work.

## Tests

Required focused tests:

- Contract schema decode/encode for new subagent events.
- ProviderRuntimeIngestion maps `subagent.*` events to parent activities.
- OpenCode: child `session.created`, child text, root text isolation, reconnect hydration.
- Claude: `task_*` to summary subagent events plus existing task events.
- Cursor: ACP tool call fallback, no transcript fabrication.
- Web view model: legacy Codex, OpenCode thread, Claude summary, Cursor summary.
- UI: summary fallback, child transcript rendering.

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
  - subagent tab close/reopen
  - no text overlap in tab strip or summary rows

## Suggested Subagent-Based Execution

When implementing, split work across coding subagents:

1. **Contracts/ingestion subagent:** schemas, ProviderRuntimeIngestion mapping, view-model derivation.
2. **Provider-native subagent:** OpenCode and Claude adapter work.
3. **ACP fallback subagent:** Cursor ACP summary fallback and tests.
4. **Web UX subagent:** view model, AgentThreadPanel changes.
5. **QA subagent:** cross-provider fixtures, regression tests, verification commands.

Run these as isolated implementation tasks and merge through one coordinator to avoid conflicting edits.

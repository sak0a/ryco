# Agent Control MCP design

**Status:** approved design

## Summary

Ryco will expose an agent-facing control plane called **Agent Control**. Supported provider sessions and separately paired external MCP clients can inspect Ryco and request work in it. Agents do not receive ambient write access: every Agent Control mutation becomes an immutable, user-visible approval request. Read-only discovery is automatic, subject to project scope and redaction.

The server remains the sole writer for application state. Agent Control never changes projections, persistence rows, worktrees, settings files, or provider state directly; it validates an approved plan and dispatches existing orchestration commands.

## Goals

- Let an agent running in a Ryco thread create and coordinate other Ryco threads.
- Let a paired external Codex, Claude, or compatible MCP client request and follow Ryco work.
- Require user approval for each exact application mutation.
- Reuse event-sourced orchestration and instance-aware provider selection.
- Preserve correctness under retries, provider restarts, turn cancellation, and worktree failures.
- Keep secrets, hosted authorization, relay traffic, and browser data outside this control plane.

## Non-goals

- A generic agent-accessible RPC proxy or shell command surface.
- Direct mutation of arbitrary server settings, credentials, or configuration files.
- Exposing internal provider-session credentials to browsers, terminal subprocesses, the Hub, relay, service worker, or external MCP clients.
- Replacing provider-native subagents. Agent Control creates normal Ryco-owned threads.
- Browser or device automation before Ryco owns a first-class shared surface to control.

## Principals and shared service

There are two ingress paths. Both use the same Agent Control service, proposal format, approval queue, executor, audit stream, and read models. They have independent credential issuance, default capabilities, rate limits, and tool catalogs.

| Principal | Purpose | Credential and scope |
| --- | --- | --- |
| Internal provider session | An agent already running in a Ryco thread coordinates Ryco work. | Per-provider-runtime, in-memory bearer; thread-bound and revoked on runtime teardown. |
| External integration | A local MCP-capable client requests work from Ryco. | Paired, revocable integration credential with explicit project and capability scope. |

The architecture is:

~~~text
Internal provider MCP ─┐
                       ├── protocol adapters ──> AgentControl service
External stdio bridge ─┘                                │
                                                        ├── projections and policy
                                                        ├── approval proposal store
                                                        └── approved-plan executor
                                                                  │
                                                                  └── OrchestrationEngine
~~~

## Package boundaries

- packages/contracts/src/agentControl.ts defines Effect Schema contracts only: principals, capabilities, action plans, proposal and execution states, MCP inputs/results, and events.
- apps/server/src/agentControl owns protocol adapters, authorization, proposal persistence, idempotency, approval execution, audit records, private credentials, and provider injection helpers.
- packages/client-runtime/src/state/agentControl owns transport-independent proposal state and decision requests for web, desktop, and mobile.
- apps/web/src/components/agent-control owns the web/desktop approval queue and cards. apps/mobile consumes the same state and supplies native screens; it does not fork policy.
- apps/server/src/orchestration remains authoritative for every project, thread, turn, session, worktree, and metadata mutation.

All target selection must use ProviderInstanceId and instance-aware model selection. A static provider-kind API would lose Ryco's configured provider instances and is not acceptable.

## Authorization and approval

### Read-only operations

Read-only tools require an explicit capability but execute automatically. Results are bounded, paginated, and sanitized. Hosted and external principals see only resources permitted by authoritative server policy; absence and authorization failures remain indistinguishable where needed to prevent resource probing.

### Mutations

Every mutation first creates an immutable AgentControlProposal containing:

- principal identity and origin;
- canonical, versioned action kind and plan payload;
- target project, thread, provider instance, worktree/base ref, and runtime-mode information;
- request id and plan digest for idempotency;
- risk tags, creation/expiry times, and an audit-safe prompt summary;
- initial pending-user-approval state.

The UI shows the card in the caller thread and a global Agent Control queue. It identifies the origin and exact impact. Full prompts require deliberate expansion; audit rows retain metadata and identifiers, not full prompts or secrets.

Accepting a proposal authorizes only its immutable digest. Immediately before dispatch, the executor revalidates permission, project state, target thread state, provider-instance availability, worktree/base-ref conditions, and runtime privilege. A stale or changed plan is rejected rather than modified or silently retried.

Rejecting, expiring, cancellation, duplicate-with-different-plan, or revalidation failure creates a terminal result readable by the originating MCP client. There is no session-wide always-allow control. Automation creation and modification require the same approval model; later runs execute only under the accepted persisted definition.

### Settings and projects

Agent Control has no generic settings-write operation. A later ryco_request_settings_change uses a typed, non-secret allowlist and creates an approval proposal. Sensitive changes use the existing owner/step-up authorization path.

Later project create/update/delete tools also create proposals. Project creation validates its workspace path and repository identity server-side. Project deletion uses the existing orchestration deletion semantics. Neither tool accepts arbitrary filesystem or process authority.

## Internal provider-session MCP

The server starts a dedicated private Agent Control transport for provider runtimes. It binds to loopback or an equivalent private local transport and is never exposed by the public HTTP server, Hub relay, service worker, browser WebSocket, or hosted data plane.

Each provider runtime receives a new in-memory credential. The session registry binds it to one thread, provider instance/runtime, and capability set. Write authority binds to the exact running turn when a request arrives. The registry synchronously retires authority when the turn ends, is interrupted, or is replaced; in-flight requests are aborted and cannot inherit authority from a later turn. Runtime exit revokes the credential.

Provider adapters inject the private MCP connection in native formats:

1. Codex is the first supported provider. It receives an environment-backed bearer configuration whose token is excluded from shell subprocess environments.
2. Claude follows with native HTTP MCP configuration.
3. ACP providers use HTTP when advertised and a small stdio-to-private-endpoint bridge otherwise.
4. Other drivers advertise control only after their adapter safely installs a scoped connection.

Provider instructions must state Agent Control availability truthfully. A provider without a safe connection receives identity context only and cannot claim to have changed Ryco.

## External MCP integrations

External MCP is separate from internal provider-session MCP. A user creates and pairs a named integration in Ryco. The local MCP client runs a stdio bridge that holds an integration credential; client configuration never contains a browser credential or internal provider bearer.

An integration has explicit project scope, capability grants, expiry, revocation, call-rate, and active-request limits. It can obtain an overview and capability catalog, list permitted projects, create a single requested task as an approval proposal, and read or wait for authorized task/proposal results.

External task creation defaults to an isolated worktree and approval-required runtime. A shared-local-checkout or elevated-runtime request requires an explicit capability as well as normal per-action approval. The bridge fails closed if it cannot verify the running Ryco instance, its credential, authority, or deadline.

External credentials have a dedicated audience and are opaque, expiring, revocable, and stored only as server-side hashes. They cannot authenticate browser, WebSocket, Hub, relay, or internal provider-session paths.

## Tool catalog

### Initial automatic read-only tools

- ryco_context
- ryco_capabilities
- ryco_list_projects
- ryco_list_threads
- ryco_read_thread
- ryco_read_control_request
- ryco_wait_for_control_request

### Initial proposal-backed mutation tools

- ryco_create_threads: one exact batch, never a generic spawning loop.
- ryco_send_message: queue or steer a specified thread.
- ryco_interrupt_thread.
- ryco_update_thread: title, archive state, or an explicitly requested persistent goal.

### Later tools

- automation create/update/cancel;
- bounded activity, orchestration-event, provider-runtime-event, and diagnosis reads;
- project create/update/delete proposals;
- allowlisted settings-change proposals;
- browser and device tools only after a corresponding Ryco-owned shared surface and independent approval policy exist.

No tool exposes arbitrary RPC method names, generic command execution, unbounded transcript dumps, settings secrets, raw authentication material, or filesystem paths as authority.

## Thread and worktree creation

ryco_create_threads accepts one immutable batch plan. Every entry includes target project, provider instance/model/options, title, prompt, environment, base ref, and runtime mode. Requests are idempotent within a principal's request-id scope. Retrying an identical plan returns the original proposal or result; reusing an id with a different plan fails.

Creation executes as a durable operation. Worktree preflight occurs before thread dispatch, created worktrees carry operation ownership evidence, and failures enter compensation. Restart recovery either performs safe cleanup or exposes a clearly terminal failure. A failed operation never creates a replacement thread without a new user request and approval.

An approval-required or worktree-isolated caller cannot drive a higher-privilege or shared-local-checkout target by proxy. This check applies to every cross-thread mutation, including steering and interruption.

## State, events, retries, and UX

Proposal and operation records have durable, monotonic state transitions. Existing client runtime transports publish proposal creation, decision, execution start, completion, and terminal failure. The executor is the only consumer of accepted proposals.

The service uses bounded timeouts, cancellation, and request-scoped locks. Stable proposal and operation ids allow wait rather than aggressive polling. Tool results cap strings and use cursors for transcript/activity/event history. Diagnostic output declares coverage so missing retained events are not misrepresented as proof that no event happened.

The Agent Control queue is a cross-platform state domain. Web presents a global queue and a thread-local activity card; mobile presents the same data natively. Cards expose accept, reject, expiry, terminal outcome, and links to affected threads/worktrees. A thread batch is one atomic card with expandable entries. Plans cannot be edited in place; changes require a new request.

The feature starts disabled by default behind a server setting. Disabled mode omits internal tool injection and rejects external integration setup.

## Stacked delivery plan

1. agent-control-foundation: contracts, migrations, principal/capability policy, proposal and operation persistence, idempotency, audit retention, and server tests.
2. agent-control-approvals: lifecycle service, accept/reject/expiry API, projection events, shared client-runtime state, and web/mobile approval surfaces.
3. agent-control-internal-mcp: private MCP protocol/transport, session and turn credential lease, cancellation, read tools, and Codex injection.
4. agent-control-thread-actions: proposal-backed thread controls, worktree saga/recovery, action cards, and results.
5. agent-control-provider-rollout: Claude and other safe adapters, each with truthful capability advertisement.
6. agent-control-external-mcp: integration management, pairing, external scopes/limits/audit, stdio bridge, and external task tools.
7. agent-control-project-settings: project actions and allowlisted settings proposals with owner/step-up checks.
8. agent-control-automation-diagnostics: automation lifecycle and bounded diagnostic reads.
9. agent-control-shared-surfaces: browser/device control only when the corresponding Ryco surface exists and is independently authorized.

Each PR is independently buildable and carries focused tests. The first destructive behavior lands only after the approval lifecycle works end-to-end.

## Validation strategy

- Contract decoding and compatibility tests for tools, plans, principals, events, and cursors.
- Unit tests for policy, exact-turn authority, idempotency, stale-plan rejection, privilege non-escalation, expiry, and redaction.
- Server integration tests for accepted/rejected execution, interruption, provider replacement, restart recovery, worktree compensation, and external credential revocation.
- Provider adapter tests proving tokens are session-scoped, absent from child shell environments, and removed on teardown.
- Focused web/mobile tests for queue projection, approval decisions, reconnect/replay, and compact cards.
- Targeted hosted lifecycle tests proving that the private endpoint never becomes a Hub, relay, service-worker, browser, or public HTTP data-plane route.

## Research basis

Synara demonstrates the useful direction: a thread-bound internal MCP control plane, durable idempotent thread creation, per-turn authority retirement, adapter-specific MCP injection, and separately scoped external MCP. Ryco adopts those concepts while strengthening the boundary for provider instances and hosted operation.

- https://github.com/Emanuele-web04/synara/blob/8f9f60045ea652db7d4a6822e2f723dde073f40a/apps/server/src/agentGateway/Layers/AgentGateway.ts
- https://github.com/Emanuele-web04/synara/blob/8f9f60045ea652db7d4a6822e2f723dde073f40a/apps/server/src/agentGateway/creationCoordinator.ts
- https://github.com/Emanuele-web04/synara/blob/8f9f60045ea652db7d4a6822e2f723dde073f40a/docs/external-mcp.md

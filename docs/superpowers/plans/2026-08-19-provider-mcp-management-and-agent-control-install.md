# Provider MCP Management and One-Click Agent Control Implementation Plan

Design: `docs/superpowers/specs/2026-08-19-provider-mcp-management-and-agent-control-install-design.md`

## Objective

Replace Ryco's Codex-only MCP settings boundary with a provider-capability registry, preserve Codex's
existing behavior, add safe native MCP management for every provider that exposes a reliable
surface, and let users connect standalone Codex and Claude clients to the external Agent Control
bridge with one click. Keep Ryco-managed Agent Control ephemeral, keep provider-native MCP config as
the source of truth, and make installation, repair, and removal recoverable without exposing a raw
credential to the browser or provider configuration.

## Execution guardrails

- Land the work in the delivery order below. Each task must leave the repository usable and keep the
  existing Codex MCP screen functional.
- Begin every task with its focused tests. Use temporary homes and fake provider executables for all
  config mutation tests; never exercise a developer's real provider configuration.
- Treat provider capability absence as data. Do not emulate health, inventory, OAuth, enablement, or
  reload behavior that a provider cannot reliably expose.
- The registry may normalize provider results but must contain no provider-format conditionals.
- Never return an external Agent Control credential, credential-file contents, secret config value,
  or full child-process environment through RPC, UI state, diagnostics, or logs.
- Serialize writes by MCP workspace and require a fresh expected fingerprint before any direct file
  rewrite. Re-read and verify after native CLI or file mutations.
- Do not mark Grok's internal Agent Control path supported until its ACP isolation and teardown tests
  prove the same turn-scoped guarantees as the currently supported providers.
- OpenCode mutations stay disabled for unrecognized versions or formats. Unsupported must remain a
  safe, actionable state rather than a best-effort rewrite.

## Task 1: Provider-neutral MCP contracts and RPC protocol

Files:

- `packages/contracts/src/mcp.ts`
- `packages/contracts/src/mcp.test.ts`
- `packages/contracts/src/agentControl.ts`
- `packages/contracts/src/agentControl.test.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/rpc.test.ts`
- `packages/contracts/src/index.ts`
- `packages/shared/src/rpcAccessPolicy.ts`
- relevant RPC access-policy tests

Steps:

1. Add failing schema round-trip tests for a non-Codex workspace, partial provider capabilities,
   unknown coverage, grouped provider instances, provider-native scope, format generation, and
   optional provider metadata.
2. Replace `managed | external | unsupported` as the behavioral contract with explicit read,
   mutate, enable, reload, health, inventory, OAuth, external-install, and automatic-internal
   capabilities. Retain a compatibility decode path only where an in-flight older client needs it.
3. Generalize `McpWorkspace` without requiring Codex home fields. Keep those values in bounded
   provider metadata so the existing Codex display can migrate without a behavior change.
4. Define operation coverage (`available`, `unavailable`, `unknown`) separately from startup and
   authentication results. A missing provider API must not become a synthetic failure.
5. Define secret presence and secret mutation contracts: responses expose only `absent | present`;
   writes express `retain | replace | clear`. Reject raw provider metadata as a writable escape
   hatch.
6. Add external Agent Control installation identifiers, detected target summaries, durable states,
   install/verify/repair/disconnect inputs, sanitized failures, and mutation results. No schema may
   contain the issued credential.
7. Add provider-neutral RPCs for target discovery and installation lifecycle while preserving the
   existing MCP RPC method names where their semantics are already neutral.
8. Mark MCP and installation reads and mutations owner-only in the shared RPC access policy, and
   test that viewer sessions cannot inspect local provider paths or mutate local configuration.

Focused validation:

```sh
bun run --cwd packages/contracts test src/mcp.test.ts src/agentControl.test.ts src/rpc.test.ts
bun run --cwd packages/contracts typecheck
bun run --cwd packages/shared test src/rpcAccessPolicy.test.ts
bun run --cwd packages/shared typecheck
```

## Task 2: MCP adapter SPI, workspace identities, and shared safety utilities

Files:

- `apps/server/src/mcp/ProviderMcpAdapter.ts`
- `apps/server/src/mcp/ProviderMcpRegistry.ts`
- `apps/server/src/mcp/ProviderMcpRegistry.test.ts`
- `apps/server/src/mcp/ProviderMcpWorkspace.ts`
- `apps/server/src/mcp/ProviderMcpWorkspace.test.ts`
- `apps/server/src/mcp/ProviderMcpMutation.ts`
- `apps/server/src/mcp/ProviderMcpMutation.test.ts`
- `apps/server/src/mcp/testing/adapterContract.ts`
- `apps/server/src/mcp/testing/fakeProviderCli.ts`
- `apps/server/src/mcp/testing/tempProviderHome.ts`

Steps:

1. Write a reusable adapter contract suite covering stable discovery, capability consistency,
   deterministic normalization, secret redaction, lossless preservation of unknown native fields,
   mutation verification, conflict handling, and idempotent removal.
2. Define `ProviderMcpAdapter` around workspace discovery plus optional operations. Make a declared
   capability and a missing operation an invariant violation caught at registration time.
3. Derive a stable, non-secret workspace id from provider driver, canonical configuration authority,
   native scope, and format generation. Group provider instances only when all identity components
   match.
4. Implement `ProviderMcpRegistry` routing and error normalization with no driver switches. Make
   stale or unknown workspace ids fail closed and force rediscovery after provider hot reload.
5. Add keyed, per-workspace mutation serialization, bounded process execution, output-size caps,
   cancellation/timeout handling, expected fingerprints, atomic replacement helpers, mode
   preservation, and post-write verification.
6. Add structured redaction for commands, arguments, environment, native config snapshots, and
   errors. Tests must plant recognizable canary credentials and assert that they never reach logs or
   public error values.
7. Build fake-CLI and temporary-home fixtures that model success, timeout, non-zero exit, malformed
   output, partial write, concurrent external edit, and process exit after write.

Focused validation:

```sh
bun run --cwd apps/server test src/mcp/ProviderMcpRegistry.test.ts src/mcp/ProviderMcpWorkspace.test.ts src/mcp/ProviderMcpMutation.test.ts
bun run --cwd apps/server typecheck
```

## Task 3: Migrate Codex behind the provider registry without regression

Files:

- `apps/server/src/mcp/CodexMcpService.ts`
- `apps/server/src/mcp/adapters/CodexMcpAdapter.ts`
- `apps/server/src/mcp/adapters/CodexMcpAdapter.test.ts`
- `apps/server/src/mcp/CodexMcpService.support.test.ts`
- `apps/server/src/ws/context.ts`
- `apps/server/src/ws/providerRpc.ts`
- relevant WebSocket RPC tests

Steps:

1. Capture the current Codex service behavior in failing adapter-contract and RPC compatibility
   tests, including shared/shadow home grouping, auth overlays, inventory detail levels, reload,
   OAuth, warnings, and disabled provider instances.
2. Extract or wrap the existing implementation as `CodexMcpAdapter`; do not rewrite working
   app-server logic while changing the service boundary.
3. Translate Codex-specific paths and mode data into optional provider metadata and declare Codex's
   full capability set explicitly.
4. Construct the registry in WebSocket context and route all existing MCP handlers through it.
   Remove direct RPC dependence on `CodexMcpService` only after compatibility tests pass.
5. Verify that workspace ids remain stable across restarts and provider display-name/accent changes,
   but change when the effective Codex configuration authority changes.
6. Keep response decoding compatible for one release boundary if older connected web clients can
   outlive a server restart; add an explicit removal note rather than leaving indefinite legacy
   branches.
7. Add Codex external-bridge install, verify, and owned-remove operations to the adapter contract so
   the later installation saga does not call Codex-specific code.

Focused validation:

```sh
bun run --cwd apps/server test src/mcp/CodexMcpService.support.test.ts src/mcp/adapters/CodexMcpAdapter.test.ts src/ws/providerRpc.test.ts
bun run --cwd apps/server typecheck
```

## Task 4: Claude external-install target and safe native command execution

Files:

- `apps/server/src/mcp/adapters/ClaudeMcpAdapter.ts`
- `apps/server/src/mcp/adapters/ClaudeMcpAdapter.test.ts`
- `apps/server/src/mcp/ProviderMcpAdaptersLive.ts`
- `apps/server/src/provider/Drivers/ClaudeDriver.ts`
- relevant provider-instance configuration helpers and tests

Steps:

1. Add external-install contract fixtures for multiple configured Claude binaries, isolated homes,
   shared homes, user scope, an existing `ryco` entry, and unrelated `.claude.json` fields.
2. Resolve the native binary, home, working directory, and environment from the provider instance;
   never silently fall back to Ryco's process home when the instance specifies an isolated one.
3. Use documented, argument-array `claude mcp` commands for the external bridge add/update/remove
   path. Bound runtime and output, disallow shell interpolation, and re-read native state after every
   mutation.
4. Advertise only external install/verify/remove capabilities in this delivery slice. General Claude
   MCP configuration, scopes, and honest health coverage land after the one-click path is complete.
5. Preserve provider-only fields and unrelated configuration. Do not make direct `.claude.json`
   rewriting the normal mutation path.
6. Generate and verify the external Agent Control stdio entry without embedding its credential.
   Verify name, executable, bridge subcommand, and credential-file reference exactly.
7. Register the limited Claude target through the common adapter layer and exercise duplicate-home
   grouping and provider hot-reload behavior. Unsupported general operations must remain visibly
   unavailable.

Focused validation:

```sh
bun run --cwd apps/server test src/mcp/adapters/ClaudeMcpAdapter.test.ts src/mcp/ProviderMcpRegistry.test.ts
bun run --cwd apps/server typecheck
```

## Task 5: Durable external installation persistence

Files:

- `apps/server/src/persistence/Migrations/051_AgentControlMcpInstallations.ts`
- `apps/server/src/persistence/Migrations/051_AgentControlMcpInstallations.test.ts`
- `apps/server/src/persistence/Migrations.ts`
- `apps/server/src/agentControl/Services/AgentControlExternalInstallation.ts`
- `apps/server/src/agentControl/Layers/AgentControlExternalInstallation.ts`
- `apps/server/src/agentControl/Layers/AgentControlExternalInstallation.test.ts`
- relevant persistence test helpers

Steps:

1. Add migration tests first, including upgrade from migration 050 and restart with an installation
   in every non-terminal state.
2. Add a durable installation table containing installation id, external integration id, provider
   driver, workspace identity, selected server name, lifecycle state, desired/native fingerprints,
   sanitized last error, timestamps, and repair generation.
3. Enforce foreign-key and uniqueness rules that prevent two active records from claiming the same
   provider workspace/server name while allowing historical disconnected records.
4. Do not persist credentials, pairing codes, provider config bodies, child-process output, or full
   environment maps. Add an SQL-level test that scans table values for planted secret canaries.
5. Define atomic compare-and-set transitions for planned, credential-written, provider-written,
   verifying, connected, repair-needed, disconnecting, disconnected, and revoked outcomes.
6. Make startup recovery enumerate incomplete records without performing provider I/O until the
   provider registry and external MCP listener are ready.

Focused validation:

```sh
bun run --cwd apps/server test src/persistence/Migrations/051_AgentControlMcpInstallations.test.ts src/agentControl/Layers/AgentControlExternalInstallation.test.ts
bun run --cwd apps/server typecheck
```

## Task 6: One-click install, verification, recovery, repair, and disconnect saga

Files:

- `apps/server/src/agentControl/Services/AgentControlExternalInstallation.ts`
- `apps/server/src/agentControl/Layers/AgentControlExternalInstallation.ts`
- `apps/server/src/agentControl/Layers/AgentControlExternalInstallation.test.ts`
- `apps/server/src/agentControl/Layers/AgentControlExternalIntegration.ts`
- `apps/server/src/agentControl/ExternalMcp/runtimeFiles.ts`
- `apps/server/src/agentControl/ExternalMcp/bridge.ts`
- `apps/server/src/agentControl/externalCredential.ts`
- `apps/server/src/agentControl/externalSetup.ts`
- `apps/server/src/server.ts`

Steps:

1. Add table-driven failure-injection tests for every boundary: integration creation, credential
   issuance, private-file write, provider mutation, native re-read, MCP initialize/list-tools probe,
   database transition, restart, and cleanup.
2. Add an internal server-only credential issuance path for installer-created integrations. Reuse the
   existing external principal, policy, listener, and bridge; do not round-trip through the browser's
   pairing ceremony.
3. Apply the approved defaults: all current/future projects, list projects, request task, read/wait
   own task, 60 calls per minute, one active task, and no expiry. Keep every mutation request subject
   to existing Ryco approval.
4. Write the credential only through the existing private runtime-file boundary with restrictive
   permissions and atomic replacement. Provider config receives a path/reference, never the value.
5. Select `ryco` when free or already owned by the exact desired fingerprint; otherwise select
   `ryco-agent-control`. If both names are unrelated, report a conflict and do not overwrite.
6. Run provider installation under the registry's workspace lock, persist progress before each side
   effect, verify the native entry after mutation, then probe bridge initialize and tool listing
   before publishing `connected`.
7. Make recovery resume from verified durable evidence rather than blindly repeat side effects.
   Reconcile a crash after each write, a missing credential file, a revoked integration, a missing
   provider profile, and a user-edited config entry.
8. Implement repair as an explicit re-plan against current fingerprints. Implement disconnect by
   revoking the external integration first, then remove the provider entry only when its current
   digest is still owned. Preserve user-modified entries and report that manual cleanup remains.
9. Make repeat connect, repair, and disconnect calls idempotent. Concurrent requests for the same
   workspace must converge on one installation record.
10. Wire recovery after the persistence store, provider registry, private runtime files, and external
    listener are ready, and finalize it before those dependencies shut down.

Focused validation:

```sh
bun run --cwd apps/server test src/agentControl/Layers/AgentControlExternalInstallation.test.ts src/agentControl/Layers/AgentControlExternalIntegration.test.ts src/agentControl/ExternalMcp/bridge.test.ts
bun run --cwd apps/server typecheck
```

## Task 7: Installation RPC handlers and shared client state

Files:

- `apps/server/src/ws/agentControlRpc.ts`
- `apps/server/src/ws/context.ts`
- `apps/server/src/ws/RpcAccessPolicy.test.ts`
- `packages/client-runtime/src/rpc/wsRpcClient.ts`
- `packages/client-runtime/src/state/settings/externalIntegrations.ts`
- `packages/client-runtime/src/state/settings/externalIntegrations.test.ts`
- `packages/client-runtime/src/state/settings/mcpInstallations.ts`
- `packages/client-runtime/src/state/settings/mcpInstallations.test.ts`
- `packages/client-runtime/src/state/settings/index.ts`

Steps:

1. Add authorization and schema tests for list targets/installations, connect, verify, repair, and
   disconnect. Confirm viewer and hosted-unready callers cannot mutate local provider configuration.
2. Route handlers to the installation service and return only provider metadata, capabilities,
   progress states, sanitized errors, and ownership/conflict status.
3. Add transport-independent client state keyed by installation and MCP workspace. Apply only newer
   revisions so reconnect snapshots cannot regress connected or conflict state.
4. Clear one-time pairing codes on refresh as today, but do not create pairing codes at all for the
   one-click server-side credential path.
5. Preserve the manual external-integration RPCs and state for advanced or unsupported-client setup.
6. Add reconnect tests proving a server restart rehydrates installation progress without exposing a
   transient credential or showing a false connected state.

Focused validation:

```sh
bun run --cwd apps/server test src/ws/RpcAccessPolicy.test.ts src/ws/agentControlRpc.test.ts
bun run --cwd packages/client-runtime test src/state/settings/externalIntegrations.test.ts src/state/settings/mcpInstallations.test.ts src/rpc/wsRpcClient.test.ts
bun run --cwd apps/server typecheck
bun run --cwd packages/client-runtime typecheck
```

## Task 8: Agent Control settings split and one-click Codex/Claude UX

Files:

- `apps/web/src/components/settings/IntegrationsSettings.tsx`
- `apps/web/src/components/settings/IntegrationsSettingsPanel.tsx`
- `apps/web/src/components/settings/IntegrationsSettings.logic.ts`
- `apps/web/src/components/settings/IntegrationsSettings.logic.test.ts`
- `apps/web/src/components/settings/IntegrationsSettings.browser.tsx`
- `apps/web/src/components/settings/IntegrationsSettingsPanel.browser.tsx`
- `apps/web/src/components/settings/settingsSearchIndex.ts`

Steps:

1. Add pure view-model tests for automatic internal support, detected standalone profiles,
   installability, progress, connected, repair-needed, conflict, unsupported, and revoked states.
2. Split the screen into `Ryco sessions` and `External agents`. Explain that supported Ryco sessions
   receive Agent Control automatically and that external installation creates a distinct scoped,
   revocable connection.
3. Show one row per built-in provider for automatic support, sourced from adapter capabilities rather
   than a UI-maintained allowlist. Do not offer installation for the internal ephemeral path.
4. Show detected Codex and Claude standalone profiles with one primary `Connect` action. Render
   progress from durable saga states and offer `Repair`, `Disconnect`, or actionable conflict help.
5. Keep `Customize` before connection for project scope, capabilities, limits, concurrency, and
   expiry. Keep the current manual pairing/config flow under an advanced disclosure for remote or
   unsupported clients.
6. Never render a raw credential, config secret, or command containing one. Use provider display
   names, native scope, and safe config path metadata only.
7. Add browser coverage for the happy path, restart during install, user-edited config on disconnect,
   duplicate-name conflict, unavailable local provider, and read-only authorization.

Focused validation:

```sh
bun run --cwd apps/web test src/components/settings/IntegrationsSettings.logic.test.ts
bun run --cwd apps/web test:browser -- IntegrationsSettings.browser.tsx IntegrationsSettingsPanel.browser.tsx
bun run --cwd apps/web typecheck
```

## Task 9: Claude general MCP management and provider-capability settings UI

Files:

- `apps/server/src/mcp/adapters/ClaudeMcpAdapter.ts`
- `apps/server/src/mcp/adapters/ClaudeMcpAdapter.test.ts`
- `apps/web/src/components/settings/McpServersSettings.tsx`
- `apps/web/src/components/settings/McpServersSettings.logic.ts`
- `apps/web/src/components/settings/McpServersSettings.logic.test.ts`
- `apps/web/src/components/settings/McpServersSettings.browser.tsx`
- `apps/web/src/hooks/useMcpServers.ts`
- `apps/web/src/rpc/` relevant MCP client binding files
- `apps/web/src/components/settings/settingsSearchIndex.ts`

Steps:

1. Extend Claude fixtures across user/project/local scopes, stdio and HTTP servers, environment
   values, shared homes, and malformed human-oriented status output.
2. Add Claude's documented native list/add/add-json/remove management operations, normalize the
   common config subset, preserve unrelated state, and keep status/inventory/OAuth coverage
   unavailable or unknown where the CLI cannot report it reliably.
3. Run the full shared adapter contract against Claude and expose its verified general-management
   capabilities only after it passes.
4. Add view-model tests for shared workspaces, provider selection, partial capabilities, unknown
   status, native scopes, masked secret fields, and unavailable operations.
5. Replace Codex-only wording and assumptions with a provider/profile selector backed by MCP
   workspaces. Group provider instances sharing one configuration authority and show that grouping.
6. Render controls only when the selected workspace advertises the matching capability. Explain
   unavailable inventory, OAuth, reload, health, enablement, or write support without presenting a
   disabled control as a provider failure.
7. Preserve the current Codex flows and detail while allowing Claude's lower-fidelity health result.
8. Implement secret retain/replace/clear controls without hydrating existing values into the form.
9. Treat `rawConfig` as read-only diagnostic metadata, bounded and redacted. Never submit it back as
   arbitrary provider configuration.
10. Add browser tests for Codex regression, Claude add/remove, shared profiles, unknown health,
    provider switch, stale fingerprint conflict, and secret replacement.

Focused validation:

```sh
bun run --cwd apps/server test src/mcp/adapters/ClaudeMcpAdapter.test.ts
bun run --cwd apps/web test src/components/settings/McpServersSettings.logic.test.ts
bun run --cwd apps/web test:browser -- McpServersSettings.browser.tsx
bun run --cwd apps/server typecheck
bun run --cwd apps/web typecheck
```

## Task 10: Copilot and Grok native adapters

Files:

- `apps/server/src/mcp/adapters/CopilotMcpAdapter.ts`
- `apps/server/src/mcp/adapters/CopilotMcpAdapter.test.ts`
- `apps/server/src/mcp/adapters/GrokMcpAdapter.ts`
- `apps/server/src/mcp/adapters/GrokMcpAdapter.test.ts`
- `apps/server/src/mcp/ProviderMcpAdaptersLive.ts`
- `apps/server/src/provider/Layers/GrokAdapter.ts`
- `apps/server/src/agentControl/ProviderInjection.ts`
- `apps/server/src/agentControl/ProviderInjection.test.ts`

Steps:

1. Add adapter-contract fixtures for Copilot JSON CLI output and user config, then implement bounded
   `copilot mcp` discovery, add/update, remove, and verification against its native user config.
2. Add Grok fixtures for global/project TOML and `grok mcp ... --json`, then implement only the
   operations proven stable by the supported Grok version range.
3. Generate external Agent Control bridge entries for each provider without credential values and
   exercise them through the shared installer failure matrix.
4. Preserve unknown provider-native fields and refuse unsupported scopes or format generations.
5. Re-audit Grok's ACP `session/new` MCP injection for per-session isolation, turn authorization,
   teardown revocation, and restart behavior. Add it to automatic internal support only if all four
   guarantees pass; otherwise keep external installation available and report internal unsupported.

Focused validation:

```sh
bun run --cwd apps/server test src/mcp/adapters/CopilotMcpAdapter.test.ts src/mcp/adapters/GrokMcpAdapter.test.ts src/agentControl/ProviderInjection.test.ts
bun run --cwd apps/server typecheck
```

## Task 11: Cursor and version-aware OpenCode adapters

Files:

- `apps/server/src/mcp/adapters/CursorMcpAdapter.ts`
- `apps/server/src/mcp/adapters/CursorMcpAdapter.test.ts`
- `apps/server/src/mcp/adapters/OpenCodeMcpAdapter.ts`
- `apps/server/src/mcp/adapters/OpenCodeMcpAdapter.test.ts`
- `apps/server/src/mcp/nativeConfig/jsonDocument.ts`
- `apps/server/src/mcp/nativeConfig/jsonDocument.test.ts`
- `apps/server/src/mcp/nativeConfig/jsoncDocument.ts`
- `apps/server/src/mcp/nativeConfig/jsoncDocument.test.ts`
- `apps/server/src/mcp/ProviderMcpAdaptersLive.ts`

Steps:

1. Add lossless document-editor tests for formatting, comments where supported, unknown keys, file
   modes, line endings, final newlines, symlinks, concurrent edits, and malformed input.
2. Implement Cursor global/project `mcp.json` discovery with explicit scope. Use a native CLI or
   extension API only where it provides a stable non-interactive operation; otherwise use guarded,
   fingerprinted JSON mutation.
3. Keep Cursor list/status/login/list-tools capabilities distinct. Do not infer health or inventory
   from config presence.
4. Detect OpenCode binary version and config generation before parsing. Implement separate V1 and V2
   codecs, including the V2 `mcp.servers` shape, and dispatch through detected format generation.
5. Use OpenCode CLI operations when stable for the detected version and guarded JSONC mutation only
   where round-trip preservation tests pass. For unknown versions, expose read-only or unsupported
   capabilities and do not write.
6. Exercise external Agent Control install/verify/remove through both adapters, including project
   scope, naming conflict, rollback, restart, and user modification after install.

Focused validation:

```sh
bun run --cwd apps/server test src/mcp/nativeConfig/jsonDocument.test.ts src/mcp/nativeConfig/jsoncDocument.test.ts src/mcp/adapters/CursorMcpAdapter.test.ts src/mcp/adapters/OpenCodeMcpAdapter.test.ts
bun run --cwd apps/server typecheck
```

## Task 12: Documentation, compatibility cleanup, and local smoke tooling

Files:

- `docs/providers/codex.md`
- `docs/providers/claude.md`
- provider guides for Copilot, Cursor, Grok, and OpenCode where present
- `docs/agent-control.md` or the current Agent Control guide
- `apps/server/scripts/provider-mcp-smoke.ts`
- `apps/server/scripts/provider-mcp-smoke.test.ts`
- `package.json`
- obsolete Codex-only MCP service files after compatibility usage reaches zero

Steps:

1. Document the internal/external Agent Control distinction, one-click defaults, approval behavior,
   repair/disconnect semantics, provider capabilities, and manual fallback without publishing local
   machine paths or operational secrets.
2. Document provider-native sources of truth and what Ryco can and cannot manage for each supported
   version. Include recovery instructions for an ownership conflict or user-edited entry.
3. Add an opt-in smoke command that creates a temporary home, points at an explicitly supplied native
   provider binary, installs a harmless fixture MCP, verifies it, removes it, and deletes only its
   validated temporary directory.
4. Run smoke tooling against installed Codex and Claude versions when available; record version and
   capability results without including user config or credentials. Extend to later adapters as they
   land.
5. Remove the Codex-only compatibility service and deprecated contract fields only after repository
   references and client compatibility tests prove they are unused.

Focused validation:

```sh
bun run --cwd apps/server test scripts/provider-mcp-smoke.test.ts
bun run --cwd apps/server provider-mcp-smoke --provider codex --dry-run
bun run --cwd apps/server provider-mcp-smoke --provider claude --dry-run
bun run --cwd apps/server typecheck
```

## Task 13: Cross-cutting security, failure, browser, and release validation

Files:

- all changed files
- provider adapter contract fixtures
- Agent Control installation failure fixtures
- settings browser tests

Steps:

1. Install the pinned dependencies before validation and fail if the lockfile would change.
2. Run the shared adapter contract suite against every registered adapter and every supported format
   generation.
3. Run the full installation failure matrix, including process restart after every durable state,
   concurrent user edits, provider CLI timeout, malformed output, listener unavailability, revoked
   integration, and disconnect retry.
4. Scan captured logs, public RPC payloads, database values, provider config fixtures, and browser
   snapshots for credential canaries.
5. Run the web browser suite because the change materially affects settings interaction, hosted
   authorization boundaries, and reconnect presentation. Install only the pinned Playwright runtime
   if it is absent.
6. Run the full repository backstop because the final change crosses contracts, persistence,
   provider runtimes, WebSocket authorization, client state, and web UI.

Validation:

```sh
bun install --frozen-lockfile
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
bun run build
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser:install
bun run --cwd apps/web test:browser
```

## Completion criteria

- Existing Codex MCP management has no functional regression and is served through the provider
  registry.
- A standalone Codex or Claude profile can be connected, verified, repaired, and disconnected from
  Ryco in one click with the approved defaults and no browser-visible credential.
- Ryco-managed sessions still receive only ephemeral, turn-scoped internal Agent Control access.
- General MCP UI behavior is driven by provider capabilities and never claims unsupported health,
  inventory, OAuth, reload, enablement, or write behavior.
- Copilot, Grok, Cursor, and recognized OpenCode versions use independent tested adapters; unknown or
  unsafe formats fail closed.
- Provider-native configuration remains the source of truth, unrelated fields and user edits are
  preserved, and disconnect never deletes an entry Ryco can no longer prove it owns.
- Installation state recovers correctly after every tested failure/restart boundary, and no raw
  external credential appears in persistence, RPC, provider config, logs, diagnostics, or UI.

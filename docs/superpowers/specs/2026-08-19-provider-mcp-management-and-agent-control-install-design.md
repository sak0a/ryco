# Provider MCP management and one-click Agent Control design

**Status:** approved design

## Summary

Ryco will make its Agent Control MCP easy to connect to standalone local coding agents and will
generalize the existing Codex-only MCP settings service into a provider-capability registry.

These are related but distinct surfaces:

- Ryco-managed provider sessions continue to receive an ephemeral, runtime-scoped Agent Control
  connection automatically when their adapter has a proven isolation boundary.
- Standalone provider clients receive a separately paired, revocable external integration through
  a local stdio bridge. One click in Ryco creates, pairs, installs, and verifies that connection
  without exposing its credential to the browser or provider configuration.
- Ordinary MCP server management continues to use each provider's native configuration as its
  source of truth. Ryco normalizes those native capabilities without copying MCP definitions into
  `settings.json`.

The first polished installation targets are Codex and Claude. The provider-neutral architecture
then adds Copilot, Grok, Cursor, and version-aware OpenCode adapters as independent, testable
increments. Providers do not need identical capabilities, and the UI must never imply they do.

## Context

Ryco currently has two Agent Control ingress paths:

1. The internal provider-session MCP listener issues an in-memory lease bound to one thread,
   provider runtime, and active turn. Codex, Claude, Copilot, and Cursor can currently receive this
   connection through their native session setup.
2. The external MCP listener authenticates a persistent, scoped integration through a local stdio
   bridge. Its current UI requires a user to create a detailed integration, copy a pairing code,
   run a terminal command, and paste provider configuration manually.

The Integrations page presents these paths together without making their different purposes clear.
The Agent Control toggle already makes the internal path automatic, while the nearby external
integration form looks like another required installation step.

The ordinary MCP settings surface is also Codex-specific. `CodexMcpService` can discover Codex
homes, use app-server configuration and inventory APIs, reload servers, and start OAuth. Other
provider rows are currently informational even though their current products expose useful MCP
configuration surfaces.

## Goals

- Explain automatic Ryco-session Agent Control separately from standalone external connections.
- Connect a detected standalone Codex or Claude profile to Ryco with one click and safe defaults.
- Preserve advanced project scope, capability, expiry, and rate-limit configuration.
- Make provider MCP management capability-driven instead of Codex-specific.
- Use provider-native configuration as the source of truth.
- Group provider instances that share a configuration home into one MCP workspace.
- Preserve unknown provider configuration and user edits.
- Keep raw Agent Control credentials out of browser RPC, provider config, logs, and child shells.
- Make installation and removal recoverable across command failure, process exit, and server
  restart.
- Let new provider adapters land without changing shared UI or RPC semantics.

## Non-goals

- Installing an internal provider-session bearer into a user or project configuration.
- Giving standalone clients the identity or write authority of a Ryco-managed provider turn.
- Synchronizing one arbitrary MCP definition across every provider.
- Replacing provider-specific MCP registries, OAuth stores, policy, or trust models.
- Guaranteeing identical inventory, health, OAuth, enablement, or scope controls for every provider.
- Editing provider config from an untrusted browser or bypassing existing owner authorization.
- Extending the frozen `apps/web` phone presentation tier.

## Terminology and separation

### Internal Agent Control

An internal connection belongs to one Ryco provider runtime. Its credential is issued in memory,
write authority is bound to the exact active turn, and teardown revokes it. It is installed only by
an audited provider adapter during session creation.

### External Agent Control

An external connection belongs to a durable, revocable integration principal. It has explicit
project and capability scope, bounded rate and concurrency limits, and the external tool catalog.
Its stdio bridge holds the credential in Ryco's private state directory. This is the connection
installed into standalone Codex, Claude, Copilot, Cursor, Grok, or OpenCode configuration.

### MCP workspace

An MCP workspace is one provider-native configuration authority. Its stable identity includes the
provider driver, resolved configuration root or scope, and adapter format generation. Multiple
provider instances that resolve to the same authority share one workspace.

## Architecture

The two MCP lanes remain separate:

```text
General MCP settings ──> ProviderMcpRegistry ──> provider-native configuration

Ryco provider session ──> runtime-scoped Agent Control lease ──> private internal listener

Standalone provider ──> provider-native stdio entry ──> Ryco external bridge
                       ──> revocable external integration ──> external listener
```

### Provider MCP registry

Replace the code-facing Codex-only service boundary with a `ProviderMcpRegistry`. The registry
discovers available adapters, resolves stable workspace ids, routes operations, serializes
mutations per workspace, and returns provider-neutral results.

`CodexMcpService` becomes the Codex adapter or is wrapped by it during migration. Codex behavior
must remain unchanged while the common registry is introduced.

Each `ProviderMcpAdapter` owns:

- workspace discovery from provider instance configuration;
- native config and runtime version detection;
- a declared capability set;
- normalization from native server definitions into shared contracts;
- safe implementation of supported list, upsert, remove, enable, reload, status, inventory, and
  OAuth operations;
- native configuration generation for an external Agent Control bridge;
- verification and redaction rules;
- identification of the exact files or native commands affected by a mutation.

The registry owns no provider-format conditionals. Adding a provider means registering one adapter,
not expanding switches in RPC handlers or React components.

### Provider capability contract

Replace the current `managed | external | unsupported` status with explicit capabilities. At
minimum the contract reports:

- read configuration;
- add or update;
- remove;
- enable or disable;
- reload;
- health status;
- tools, resources, and templates inventory;
- OAuth start and logout where available;
- supported user, project, directory, or runtime scopes;
- external Agent Control install, verify, repair, and remove;
- automatic internal Agent Control support.

Every operation response states its coverage. Missing inventory or health support is `unavailable`
or `unknown`, never a fabricated success or failure.

### Shared contracts

Generalize `McpWorkspace` so it includes provider driver, provider display metadata, native scope,
format generation, capability descriptor, and grouped provider instance usage. Codex-specific
fields such as shared and shadow home paths move into optional provider metadata that the UI can
display without depending on it.

Keep `McpServerConfig` as the normalized common subset. Provider-specific fields remain in bounded
raw metadata for round-trip preservation but are not exposed as an arbitrary write channel.

Secret-bearing fields use explicit values such as `absent`, `present`, or `replacement supplied`.
An update expresses `retain`, `replace`, or `clear`; the server never sends an existing secret to
the browser merely so a form can round-trip it.

## Provider adapters

### Codex

Codex retains full management through app-server configuration, MCP status and inventory, reload,
and OAuth APIs. The adapter continues grouping shadow homes by their shared `CODEX_HOME`. Native
CLI fallback remains bounded to operations app-server cannot safely express.

### Claude

Claude uses the configured binary and resolved Claude `HOME`. Mutations use documented `claude mcp`
commands, including user-scoped `add` or `add-json` and `remove`. The adapter does not parse or
rewrite unrelated `.claude.json` state as its normal mutation path.

Claude's CLI currently lacks a stable JSON form for all list and health output. The adapter returns
bounded configuration and health coverage separately, and treats unparseable status as unknown.
This limitation does not block installation or removal.

### GitHub Copilot

Copilot uses its user MCP CLI and machine-readable list/get operations. The adapter resolves the
effective Copilot configuration home, invokes the configured binary, and preserves registry and
organization policy failures as bounded capability errors.

### Cursor

Cursor uses its documented global or project `mcp.json` authority. Its adapter performs guarded,
atomic JSON updates while preserving unrelated servers and fields, then uses the agent CLI for
list, status, tool inventory, or login where supported. A future Cursor extension API integration
can replace file mutation without changing the registry contract.

### Grok

Grok uses its current MCP CLI for add, remove, enable, disable, and JSON diagnostics, with user or
project scope. Its adapter resolves the configured Grok home and version before selecting native
arguments.

Grok's current ACP implementation also accepts session `mcpServers`. Internal Agent Control support
must be re-audited and enabled only after tests prove credential isolation, exact-turn authority,
failure fallback, and teardown revocation.

### OpenCode

OpenCode is explicitly version-aware. Its V1 and V2 MCP configuration shapes differ, so the adapter
detects the installed generation before reading or writing. Unknown generations are read-only and
return an actionable unsupported-version result. Atomic JSON or JSONC mutation preserves unrelated
configuration. External Agent Control installation can be supported even while internal
provider-session injection remains disabled because the external integration has a different,
durable principal boundary.

## One-click Agent Control installation

### Defaults

The primary `Connect` action uses the existing safe external defaults:

- all current and future Ryco projects;
- list allowed projects;
- request one task;
- read or wait for tasks created by the integration;
- 60 admitted calls per minute;
- one active task;
- no automatic expiry;
- normal approval requirements for every mutation.

`Customize` exposes project selection, additional external capabilities, expiry, and limits before
installation.

### Durable installation record

Add a durable external installation record separate from the integration credential row. It stores:

- installation id and integration id;
- provider workspace id, driver, provider instance/profile display identity, and native scope;
- selected server name;
- operation state and last bounded failure code;
- expected normalized provider entry and digest;
- provider config fingerprint observed before and after installation;
- timestamps for prepare, configure, verify, connect, repair, disconnect, and terminal failure.

It never stores a raw credential, pairing code, secret environment value, or full provider config.
The installation target uses a provider driver and workspace id rather than expanding the existing
presentation-oriented external `clientKind` enum for every future provider.

### Installation flow

The owner-authorized, loopback-only server operation performs:

1. Revalidate Agent Control policy, topology, provider workspace, and adapter capabilities.
2. Reserve `ryco` when unused. If it is unrelated, try `ryco-agent-control`. If both names are
   unrelated, return a conflict instead of overwriting either.
3. Create the external integration and installation record.
4. Issue the external credential through an internal service method that is not available over
   browser RPC.
5. Write the credential to the existing private bridge credential store with owner-only
   permissions.
6. Ask the provider adapter to install the stdio bridge command and exact integration id.
7. Re-read the provider entry and store its verified digest.
8. Initialize the bridge and list tools through the installed command.
9. Mark the installation connected only after both config and protocol verification succeed.

The browser receives status and bounded diagnostics, never credential material.

### Repair and disconnect

Repair revalidates the integration, credential file, provider entry, runtime descriptor, and MCP
handshake. It replaces only missing or still-owned material.

Disconnect first retires connection use, then removes the provider entry only if its current digest
matches the recorded owned digest. It deletes the private credential and revokes the integration.
If the provider entry was modified, Ryco revokes access and preserves the entry, returning a manual
cleanup warning.

Advanced `Revoke access` can revoke the integration without removing provider configuration. Manual
configuration remains available for providers or environments that Ryco cannot mutate safely.

## Mutation safety and recovery

Every workspace mutation takes a per-workspace lock and follows:

1. Resolve the exact provider binary, environment, home, version, scope, and config authority.
2. Read current normalized state and calculate a precondition fingerprint.
3. Apply through a documented native API or CLI when possible.
4. Otherwise perform an atomic, format-preserving config update.
5. Re-read and verify the requested result.
6. Publish the verified snapshot.

Native commands have bounded timeouts, output limits, and redaction. They use the configured binary
and provider environment rather than an ambient command from `PATH` when an instance has explicit
settings.

Agent Control installation is a recoverable saga. Failure compensates completed steps in reverse:
remove an owned provider entry, delete the credential file, revoke the integration, and mark the
operation terminal. Restart recovery reconciles every nonterminal installation from durable state.
Compensation never removes an entry without matching ownership evidence.

Ordinary single-provider config mutations take a bounded before snapshot. File-backed adapters can
restore the original bytes after failed verification. CLI-backed adapters use the provider's
inverse operation when it is safe and otherwise report partial failure with exact recovery guidance.

## Authorization and confidentiality

- Existing MCP RPC methods remain owner-authorized.
- One-click external setup additionally requires Agent Control enabled and the existing proven
  loopback-only topology. Hosted, relayed, remotely exposed, or ambiguous topology fails closed.
- The raw external credential exists only in the one-time service exchange and the private
  owner-readable bridge credential file. Persistence retains only its hash.
- Provider configuration contains the bridge command, entry point, integration id, and state
  directory, but no bearer, browser token, pairing code, cookie, DPoP proof, or internal lease.
- Logs, traces, RPC errors, installation records, and CLI diagnostics use bounded structured reason
  codes and redacted text.
- Internal Agent Control credentials remain runtime-scoped and absent from shell subprocess
  environments.
- General MCP configuration reads redact literal secrets. The browser can retain, replace, or clear
  them without retrieving them.

## User experience

### Agent Control section

The Integrations page separates:

1. **Ryco sessions.** Shows the feature toggle and every configured provider's automatic internal
   support as `Automatic`, `Unavailable`, or a precise reason. It explains that a new supported
   provider session receives the tools without installation.
2. **External agents.** Shows detected provider profiles with `Connect` or current connection
   status. Codex and Claude are primary actions; other adapters appear with the same capability
   model as they land.

Connection state progresses through preparing, configuring, verifying, connected, repair needed,
disconnecting, and failed. A row offers Customize access, Repair, Copy manual configuration, and
Disconnect. Advanced controls expose credential-only revocation and detailed bounded diagnostics.

### General MCP section

The MCP settings page uses a provider/profile selector instead of a Codex-only workspace selector.
The selected workspace controls the server list and available actions. Shared provider homes show
which provider instances use them.

Forms render the common transport and timeout fields plus only the provider-supported options.
Capability badges explain missing status, inventory, OAuth, toggle, or scope support. Unknown
provider fields can be preserved but are not editable through a generic raw JSON escape hatch.

Cross-provider copying or synchronization is outside the initial scope. Users manage each native
authority independently.

## RPC and client state

General MCP RPC names remain stable while their contracts become provider-neutral. Add bounded
methods for provider capability discovery and external installation connect, repair, disconnect,
and status. Mutations accept workspace and expected fingerprint preconditions so stale browser
state cannot overwrite newer native changes.

Client runtime owns transport-independent installation state and reconciliation. Web consumes that
state; mobile can present the same status later but does not gain a second installation policy.
The frozen web phone tier is unchanged.

## Delivery sequence

1. Generalize MCP contracts and extract `ProviderMcpRegistry`, preserving Codex behavior.
2. Add external installation persistence, recovery, RPC, and shared client state.
3. Ship polished one-click Codex and Claude Agent Control connection.
4. Add Claude general MCP management within its honest status limitations.
5. Add Copilot and Grok adapters and re-audit Grok internal injection.
6. Add the guarded Cursor adapter.
7. Add version-aware OpenCode configuration support.
8. Remove obsolete Codex-only UI language after every registered adapter reports through the common
   capability surface.

Each step is independently buildable and preserves truthful support reporting for providers not yet
implemented.

## Validation strategy

### Shared adapter contract suite

Every adapter runs the same behavioral tests for workspace identity, capability reporting,
normalization, secret redaction, stale fingerprint rejection, supported mutations, post-mutation
verification, timeout, and bounded failure output.

### Provider fixtures and fake CLIs

- Codex app-server fixtures preserve shadow-home grouping, config round trips, reload, inventory,
  and OAuth behavior.
- Claude fake CLI tests exact `HOME`, binary path, scope, add/get/list/remove behavior, and unknown
  health output.
- Copilot tests JSON list/get normalization and user config mutation.
- Cursor tests atomic merge, unrelated key preservation, malformed input failure, and CLI status.
- Grok tests user/project scope, enablement, removal, and JSON doctor normalization.
- OpenCode tests V1, V2, JSONC preservation, and unknown-version read-only behavior.

Tests use temporary provider homes and fake binaries. They never read or mutate a developer's real
provider configuration.

### Agent Control recovery and security

Inject failure after every installation and disconnection step. Tests cover process exit and server
restart, idempotent retry, conflicting names, user-modified entries, missing credential files,
revocation, and compensation.

Assertions prove raw credentials do not appear in RPC results, logs, persistence, provider config,
child shell environments, snapshots, or browser state.

### UI and browser coverage

Focused component and browser tests cover automatic-session explanation, one-click connect,
customized access, progress, successful verification, repair, name conflicts, partial provider
capabilities, manual fallback, modified-entry preservation, and disconnect.

### Local smoke coverage

A manually invoked smoke harness uses detected Codex and Claude binaries with isolated temporary
homes. It verifies native command compatibility without touching real user configuration.

## Compatibility and migration

Existing external integrations, pairing commands, credential files, and manual configuration stay
valid. The installation table is additive. Ryco does not infer ownership of an existing provider
entry merely because it is named `ryco`.

When a user explicitly chooses Repair for a legacy integration, Ryco verifies that its bridge
command and integration id match the existing record before adopting it into a managed installation.
Otherwise the entry remains manual. The generalized MCP contracts retain decode defaults needed by
older clients during the transition, and Codex workspace ids keep their current meaning until the
registry migration publishes an explicit compatibility mapping.

## Acceptance criteria

- A local owner can connect a detected Codex or Claude profile without running a command or pasting
  configuration.
- The connected client completes an MCP handshake and sees the external Agent Control tool catalog.
- Every mutation requested through Agent Control still follows its existing approval policy.
- Ryco-managed supported sessions continue receiving internal Agent Control automatically.
- General MCP settings can select provider-native workspaces and expose only verified capabilities.
- Shared provider homes produce one workspace rather than duplicated configuration.
- Failure at any tested installation step leaves no usable orphan credential and no unowned config
  deletion.
- Disconnect never removes a user-modified or unrelated provider entry.
- Existing secrets are never returned to the browser.
- Codex behavior does not regress while the provider-neutral registry is introduced.

## Research basis

- OpenAI Codex MCP configuration and CLI: https://developers.openai.com/codex/mcp
- Claude Code MCP configuration and scopes: https://code.claude.com/docs/en/mcp
- GitHub Copilot CLI MCP management: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
- Cursor MCP configuration: https://docs.cursor.com/context/model-context-protocol
- OpenCode V2 MCP configuration: https://opencode.ai/v2/docs/mcp-servers
- Grok Build MCP and ACP configuration: https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/README.md

# Grok CLI ACP Provider Design

**Date:** 2026-08-03

## Summary

Add Grok Build as a first-class Ryco provider through the CLI's native Agent Client Protocol (ACP) server. Ryco will spawn `grok agent stdio`, use the user's existing Grok authentication, and provide the same end-to-end experience expected from other built-in providers: provider settings and status, model discovery and selection, new and resumed chat sessions, streamed runtime events, approvals, user questions, attachments, cancellation, and git/title text generation.

The implementation will be a focused port of t3code's proven Grok integration into Ryco's current provider-instance architecture. It will reuse Ryco's existing generic ACP runtime and extract shared Cursor/Grok helpers only when the behavior is truly provider-independent. It will not begin with a broad rewrite of the Cursor adapter.

Primary references:

- [t3code Grok provider implementation](https://github.com/pingdotgg/t3code/tree/main/apps/server/src/provider)
- [Grok Build overview](https://docs.x.ai/build/overview)
- [Grok Build CLI reference](https://docs.x.ai/build/cli/reference)
- [Grok Build headless and ACP documentation](https://docs.x.ai/build/cli/headless-scripting)

## Goals

- Register `grok` as a built-in provider driver with normal provider-instance behavior, including multiple instances and per-instance environment variables.
- Start Grok through its native `grok agent stdio` ACP transport rather than a direct xAI API integration.
- Support new sessions, persisted continuation, model discovery and selection, streaming, tool events, plans, approvals, user questions, attachments, cancellation, and reliable teardown.
- Make Grok available throughout the web settings, provider picker, model picker, and session creation flows.
- Use Grok for thread titles, branch names, commit messages, and pull-request content when it is the selected text-generation provider.
- Keep Grok process and protocol failures isolated from other providers and sessions.
- Preserve existing provider settings, persisted threads, and unknown-provider forward compatibility.

## Non-goals

- Do not call the xAI HTTP API directly or add an xAI SDK.
- Do not install, authenticate, or update Grok automatically. Ryco will provide installation and login guidance; users own the CLI installation and credentials.
- Do not replace the shared ACP runtime or refactor every ACP-speaking provider into a new universal adapter as part of this change.
- Do not add Grok-specific authentication, lifecycle, or synchronization logic to client applications.
- Do not extend the frozen web phone presentation tier.

## User Experience and Defaults

Grok appears as a built-in provider named **Grok**, with an Early Access badge and its own icon. The default instance is enabled, matching t3code's first-class integration. When the CLI is absent or authentication fails, the provider remains visible and reports a provider-scoped status with remediation guidance instead of affecting server readiness or other providers.

The settings form exposes a custom binary path and uses the generic provider-instance environment editor for values such as `XAI_API_KEY`. Model configuration follows the existing provider model-preference UI. Grok reports `grok-build` as a fallback model when ACP discovery returns no catalog, while also preserving any configured custom models.

The provider documentation will explain:

- Installing Grok Build from xAI.
- Running `grok login`, including device authentication for remote/headless environments where applicable.
- Using `XAI_API_KEY` through the instance environment as an alternative to cached login credentials.
- Overriding the binary path.
- Diagnosing missing binaries, ACP startup failures, and authentication failures.
- The requirement to start a new thread when changing the Grok model.

## Architecture

### Contracts and settings

Add `GrokSettings` to the contracts package with:

- `enabled`, defaulting to `true` and hidden in the generic settings form.
- `binaryPath`, defaulting to `grok` and exposed in the settings form.
- `customModels`, defaulting to an empty array and managed by the model preferences UI.

Add Grok to the legacy `providers` settings mirror and patch schema so existing default-instance hydration continues to work. Add `grok` model and text-generation defaults, slug aliases where useful, and the `Grok` display name. `ProviderDriverKind` remains an open branded slug; no closed-union change is required.

Existing settings and persisted selections must continue to decode without migration. The synthesized default Grok instance uses `defaultInstanceIdForDriver(ProviderDriverKind.make("grok"))`, while explicit `providerInstances.grok` configuration continues to win over the legacy mirror.

### Driver registration

Add a lazy Grok driver to `BUILT_IN_DRIVERS`. The driver will:

- Decode `GrokSettings`.
- Merge instance environment variables without mutating `process.env`.
- Stamp snapshots with the instance ID, display-name override, accent color, driver kind, and continuation group.
- Construct the Grok provider adapter and Grok text-generation service.
- Construct a managed provider snapshot and provider-scoped maintenance capabilities.
- Declare all required Effect services through `GrokDriverEnv`.

Grok updates remain manual in this change. Provider status can report the installed version, but Ryco will not infer a package manager or execute `grok update` automatically.

### ACP runtime support

Add a small Grok ACP support module over the existing `AcpSessionRuntime`. It builds the child-process input:

```text
command: <configured binary path or "grok">
args: ["agent", "stdio"]
cwd: <thread project directory>
```

The spawned environment includes all per-instance environment variables and a Ryco-specific `GROK_OAUTH2_REFERRER` value. Authentication selection is deterministic:

- Use ACP auth method `xai.api_key` when a non-empty `XAI_API_KEY` is present.
- Otherwise use Grok's `cached_token` method.

The support module normalizes Grok model IDs, applies model selection through ACP `session/set_model`, and obtains the current model from the session setup response.

### xAI protocol extensions

Keep xAI-specific compatibility outside the generic ACP runtime.

The prompt-completion wrapper supports both completion paths:

- The standards-based ACP `session/prompt` response.
- Grok's `_x.ai/session/prompt_complete` extension notification used by older or transitional CLI versions.

Both paths race for the same prompt. Completion IDs are tracked and bounded so a late response cannot complete a later prompt or grow memory without limit. The standards path remains authoritative when it resolves first.

Handle `x.ai/ask_user_question` and `_x.ai/ask_user_question` extension requests. Convert Grok questions into Ryco's existing `UserInputQuestion` contract, preserving option labels, descriptions, previews, multi-select behavior, and free-form notes. Convert accepted answers or cancellation back into Grok's expected extension response without teaching the shared ACP runtime about xAI payloads.

### Provider status and model discovery

Provider checks proceed in two bounded phases:

1. Run `grok --version` to distinguish a missing binary, non-zero exit, timeout, and successful installation.
2. Start a short-lived ACP session and read the session model state.

Discovered models are deduplicated after normalization and converted into normal `ServerProviderModel` entries. If discovery returns no models, use `grok-build`. Configured custom models are merged through the existing provider snapshot helper.

All probe branches return a valid Grok provider snapshot. Missing binaries and failed or timed-out ACP startup produce an error status and actionable message; they do not fail provider registry construction. Authentication remains `unknown` until the ACP startup path can establish it reliably.

The snapshot presentation is:

- Display name: `Grok`.
- Badge: `Early Access`.
- Interaction-mode toggle: hidden unless Grok's ACP-reported mode support can be mapped without inventing semantics.
- Model changes: require a new thread.

### Session adapter

Add a Grok adapter implementing Ryco's `ProviderAdapter` service. Each thread owns an isolated session context containing:

- The Ryco thread and provider session identity.
- A closeable Effect scope that owns the child process and listeners.
- The Grok ACP runtime.
- The notification fiber.
- Pending approval and user-input deferred values.
- Active-turn and streamed-item bookkeeping.
- Stop state and resume metadata.

Starting a session creates the scoped ACP runtime in the requested working directory. A new thread uses ACP `session/new`; a continuation validates and loads the persisted Grok resume payload. The adapter stores a versioned opaque resume object containing the Grok session ID. Invalid or unsupported resume data produces a validation error instead of starting the wrong session.

Before prompting, the adapter applies the requested model when it belongs to the bound provider instance. The prompt contains text and resolved attachment paths using Ryco's attachment store. Standard ACP notifications map through shared helpers to Ryco runtime events for:

- Assistant content and reasoning chunks.
- Plan updates.
- Tool calls and terminal activity.
- Token usage.
- Permission requests and their resolutions.
- Turn and session completion or failure.

The adapter handles runtime modes consistently with existing providers. Auto mode selects an allowed permission option when ACP supplies one. Approval-required mode opens a Ryco approval request and waits for the user's decision. Grok question requests open Ryco user-input requests and wait for answers. Unsupported or malformed requests fail at the provider boundary with useful context.

Cancellation interrupts the active prompt and resolves pending approvals or questions as cancelled. Session stop closes the notification fiber, child process, and scope. Thread-level locking serializes start, prompt, cancel, and stop operations for a thread while allowing independent threads to run concurrently.

### Text generation

Add a Grok text-generation service using the same ACP runtime and model-selection support. It accumulates assistant text for the existing structured prompts used by:

- Commit messages.
- Pull-request titles and bodies.
- Branch names.
- Thread titles.

The service applies a bounded prompt timeout, extracts the JSON object from streamed assistant output, decodes it against the existing operation-specific schema, and runs existing sanitizers. Empty, cancelled, malformed, or timed-out responses become `TextGenerationError` values scoped to the requested operation.

### Web integration

Add Grok to browser-safe provider metadata and presentation:

- Provider label, icon, settings schema, and Early Access badge.
- Provider-instance icon lookup and generic fallback behavior.
- Provider/session selection logic and model defaults.
- Model picker behavior and new-thread requirement.
- Relevant keybinding/toast and runtime-catalog fixtures.

The web app remains a consumer of generic provider contracts and runtime events. It will not contain Grok authentication or ACP lifecycle code.

## Error Handling and Lifecycle Invariants

- Every version probe, ACP discovery session, and text-generation prompt has a bounded timeout.
- A missing or unhealthy Grok CLI yields a Grok snapshot with an actionable status rather than preventing server startup.
- Process startup, protocol decoding, resume, prompt, and model-selection failures map to existing provider adapter error types with Grok-specific context.
- A Grok process belongs to exactly one scoped session context and cannot outlive teardown.
- Pending approvals and questions are always settled during cancellation or stop.
- Late completion notifications are deduplicated and cannot complete the wrong turn.
- Stale or malformed resume state cannot publish readiness or mutation authority for a new session.
- One thread's lock, failures, or cancellation cannot affect another Grok thread or another provider.
- Existing Cursor ACP behavior remains unchanged.

## Testing

### Contracts and registry

- Decode Grok defaults and explicit settings.
- Apply Grok settings patches and preserve existing provider settings.
- Hydrate the synthesized default Grok instance and respect explicit instance overrides.
- Register Grok in the built-in registry without changing unknown-driver handling.

### ACP support and extensions

- Build default and custom binary spawn inputs with the expected arguments, working directory, referrer, and environment.
- Select API-key versus cached-token auth correctly.
- Normalize and apply model IDs, including no-op model selection.
- Validate current model and resume identity handling.
- Complete prompts through either standard ACP or the xAI notification fallback.
- Ignore duplicate or stale completion notifications and bound completion history.
- Convert single-select, multi-select, preview, free-form, and cancelled Grok questions in both directions.

### Provider and adapter

- Report missing binary, non-zero version exit, version timeout, ACP startup failure, ACP startup timeout, discovered models, fallback models, and custom models.
- Start new sessions and resume valid persisted sessions.
- Reject malformed or unsupported resume payloads.
- Map assistant, reasoning, plan, tool, terminal, usage, approval, question, and completion events.
- Route attachments as resolved local paths.
- Apply the selected model before prompting.
- Exercise auto and approval-required permission behavior.
- Cancel active turns, settle pending interactions, stop processes, and keep concurrent thread contexts independent.

### Text generation and web

- Generate and sanitize all four text-generation operations.
- Cover model selection, invalid JSON, empty output, cancellation, process failure, and timeout.
- Show Grok in provider settings and selection surfaces with the correct icon, badge, defaults, and model-change behavior.
- Update provider/runtime fixtures so Grok does not regress existing provider ordering or selection logic.

## Validation

Run focused tests while implementing, followed by the complete repository backstop:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
```

Because the change affects provider settings and web interaction, also run:

```sh
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser:install  # only if the pinned runtime is absent
bun run --cwd apps/web test:browser
```

## Rollout

Grok ships as an Early Access built-in provider. There is no persisted-data rewrite. The existing provider settings decoder supplies defaults for installations that predate Grok, and provider-instance hydration creates the default Grok instance on startup. Users can disable that instance or add additional Grok instances with separate binary paths and environments through the standard provider settings UI.

The initial release should be evaluated against both cached `grok login` authentication and `XAI_API_KEY`, including a current Grok Build release and the older prompt-completion extension path retained from t3code.

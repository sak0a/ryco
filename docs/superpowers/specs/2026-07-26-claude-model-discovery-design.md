# Automatic Claude Model Discovery

## Summary

Ryco will use the Claude Agent SDK initialization result as the authoritative
source of account-specific Claude models. A successful initialization probe
will replace the maintained built-in catalog with models mapped from
`init.models`, then append user-configured custom models. This allows newly
released models such as Claude Opus 5 to appear without a Ryco release.

The existing static Claude catalog remains compatibility data. Ryco uses it
while a provider is pending or disabled, as the cold fallback when discovery
has never succeeded, and as an exact-slug metadata overlay for Ryco behavior
that the SDK does not describe.

## Goals

- Discover the models available to each configured Claude account and
  installation without sending a prompt or making an Anthropic API request.
- Make a newly released SDK model selectable without adding a version gate or
  hardcoded catalog entry.
- Derive model effort and fast-mode controls from SDK metadata.
- Keep Ryco-only model behavior where an exact static metadata entry exists.
- Merge user-configured custom models without duplicates.
- Avoid replacing a previously successful discovery with the static catalog
  because of a transient probe failure.
- Ensure dynamically discovered capabilities are honored when Ryco starts a
  Claude turn or invokes Claude text-generation helpers.

## Non-goals

- Discover model pricing, token limits, or context-window variants that the
  Claude Agent SDK does not expose.
- Add a separate UI control for adaptive thinking. Claude manages adaptive
  thinking, while the SDK effort metadata supplies the user-facing control.
- Infer capabilities from model-family names or release numbers.
- Change authentication, relay, orchestration, or provider-instance ownership.

## Existing Behavior

`ClaudeProvider.ts` already calls `initializationResult()` in a lightweight
Claude Agent SDK session. Its prompt is a never-yielding async iterable, the
probe disables tools and persistence, and the subprocess is aborted after
initialization. The result currently supplies account metadata and slash
commands, but `init.models` is ignored.

Claude models are instead maintained in `BUILT_IN_MODELS`. Several entries are
filtered by Claude CLI version, and upgrade messages name individual releases.
This creates a Ryco release dependency for every Claude model release.

The Claude adapter and Claude text-generation helper also look up capabilities
in the static table. Merely showing dynamically discovered options in the
provider snapshot would therefore be incomplete: effort and fast-mode choices
for an unknown model could be displayed but ignored at execution time.

## Model Mapping

The initialization probe will include a normalized model inventory in its
result. Each valid SDK `ModelInfo` maps to one `ServerProviderModel`:

| SDK field                  | Ryco field or behavior                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `value`                    | `slug`                                                                                                   |
| `displayName`              | `name`                                                                                                   |
| `supportedEffortLevels`    | `effort` select options                                                                                  |
| `supportsEffort`           | Enables the effort descriptor when levels are present                                                    |
| `supportsAdaptiveThinking` | Confirms that reasoning is SDK-managed; it does not create a second Ryco toggle or serialized capability |
| `supportsFastMode`         | Adds the `fastMode` boolean descriptor                                                                   |
| SDK-discovered entry       | `isCustom: false`                                                                                        |

Whitespace-only identifiers or names are ignored. Duplicate SDK identifiers
are deduplicated in SDK order, keeping the first valid entry.

The SDK does not currently expose a default effort. For a model without a
matching static entry, Ryco leaves the effort descriptor without an explicit
current/default value and lets Claude apply its default. Ryco does not guess a
default from the model name or the order of the SDK array.

## Static Metadata Overlay

After deriving capabilities from SDK metadata, Ryco overlays an existing
static entry only when its slug exactly matches the discovered SDK identifier.
The overlay is limited to data or behavior that the SDK does not expose:

- `shortName`;
- the known default effort, when present in the SDK-reported level set;
- Ryco prompt-injected `ultrathink`;
- Ryco's `ultracode` compatibility mode;
- the context-window selector used to construct a `[1m]` model identifier;
- legacy `thinking` controls that remain necessary for an exact known model.

SDK metadata wins for facts it exposes. In particular, a static entry cannot
add an SDK effort level, adaptive-thinking support, or fast mode that the
discovered entry says is unavailable. Static metadata is never selected by
family-name or version-pattern matching, so an unknown Opus 5 entry cannot
accidentally inherit Opus 4 behavior.

## Inventory Selection and Fallback

Each Claude provider instance owns its discovery state because initialization
is account- and environment-specific.

The inventory selection order is:

1. Models from the latest successful initialization result.
2. The last successful discovered inventory retained by that provider
   instance when a later probe fails.
3. The static compatibility catalog when discovery has never succeeded for
   that instance.

User-configured custom models are appended after selecting the base inventory.
They are normalized and deduplicated by slug through the shared
`providerModelsFromSettings` behavior. A custom model whose slug is already in
the selected inventory does not replace the discovered model.

A successful initialization result is authoritative even if it omits models
that exist in static or previously cached data. Ryco must not union old
built-ins into that successful list. This is necessary for account-specific
availability and for removing retired aliases. An empty but structurally valid
`init.models` array is also authoritative; only failure to obtain a successful
initialization result activates fallback.

Pending and disabled snapshots may continue to use the static catalog because
they have not completed discovery. Existing provider snapshot persistence can
still render cached models during startup, but the first successful discovery
replaces them.

## Version Gates and Messages

The successful discovery path will not filter models by the installed Claude
version and will not emit per-release upgrade messages. The installed CLI and
the account-specific initialization response already determine the available
inventory.

Existing version filters remain confined to the cold static fallback so an old
Claude installation is not offered a known-incompatible hardcoded model. They
are not consulted after successful discovery. Forward-looking placeholder
gates and release-specific upgrade messages that do not protect the cold
fallback are removed.

## Runtime Capability Ownership

The same per-instance discovered capability inventory used for provider
snapshots must be available to:

- `ClaudeAdapter` turn construction and prompt-prefix handling; and
- `ClaudeTextGeneration` CLI invocation.

Capability resolution first checks the current per-instance inventory and then
uses the exact-slug static fallback. This preserves current Ryco-only behavior
for known models while allowing a newly discovered model's SDK effort and
fast-mode options to reach the SDK or CLI.

Runtime resolution must not use a process-global mutable catalog. Multiple
Claude provider instances can represent different accounts, binaries, homes,
or environments and may receive different `init.models` results.

## Failure Handling

- A timeout, subprocess failure, or malformed initialization result retains
  the existing authentication warning behavior.
- Discovery failure does not erase a last successful inventory for the
  instance.
- If no successful inventory exists, the static catalog supplies models.
- Invalid individual model entries are skipped without failing an otherwise
  successful initialization result.
- Custom models remain available in all fallback states.
- The probe continues to abort its Claude subprocess in an ensuring/finalizer
  path and continues to send no prompt.

## Tests

`ProviderRegistry.test.ts` will cover:

- a successful probe that discovers a previously unknown `claude-opus-5`;
- mapping its display name, effort levels, adaptive-thinking metadata, and
  fast-mode support;
- treating the discovered list as authoritative rather than unioning static
  release entries;
- exact-slug static overlay behavior without family-name inference;
- merging and deduplicating user custom models;
- retaining the last successful discovered list after a later probe failure;
- using the static list when discovery has never succeeded; and
- accepting an authoritative empty discovered list.

Focused Claude adapter and text-generation tests will verify that effort and
fast mode for a dynamically discovered model are forwarded at execution time.
Existing release-gate tests will be removed or narrowed to cold-fallback
compatibility behavior.

## Validation

The implementation will run the repository-required backstop:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
```

No browser-suite run is required unless implementation changes a web
interaction or browser lifecycle beyond consuming the existing provider model
contract.

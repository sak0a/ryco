# Model manifest

Claude model metadata lives in `apps/server/src/provider/model-manifest.json`
instead of server code. The bundled copy ships with every release; at runtime
the server refreshes it from the same file on `main`
(`https://raw.githubusercontent.com/saka-gg/ryco/main/apps/server/src/provider/model-manifest.json`),
so a new Claude model can be published to every install by merging an edit to
that one file — no client release required.

Preference order at runtime: fresh remote fetch → last successfully fetched
copy on disk (`<stateDir>/model-manifest.json`) → the bundled file. A failed
or invalid fetch never fails a provider check, and an invalid remote manifest
is rejected wholesale (schema + cross-reference + Claude adapter validation)
rather than partially applied. Fetches respect the
`enableProviderUpdateChecks` server setting and are TTL-gated (1 h fresh,
5 min retry backoff after a failure).

## File format (v1)

```jsonc
{
  "version": 1,
  // Overlay classification per driver kind; kept for format parity with
  // upstream t3code. Ryco derives legacy flags from `status` below instead.
  "currentModels": { "claudeAgent": ["claude-fable-5-1", "..."] },
  "providers": {
    "claudeAgent": {
      "defaults": { "chat": "claude-opus-5" }, // marks isDefault
      "profiles": {
        "fable-5-1": {
          // Decodes against the contracts `ModelCapabilities` schema and is
          // served to clients verbatim (option descriptors for the picker).
          "capabilities": { "optionDescriptors": [/* … */] },
          // Claude-specific runtime behavior (allowlisted adapter payload):
          "adapter": {
            "claudeCode": {
              "effortMap": { "ultracode": "xhigh", "ultrathink": null },
              "modelSuffixes": { "contextWindow": { "1m": "[1m]" } },
              "contextWindowTokens": { "200k": 200000, "1m": 1000000 },
            },
          },
        },
      },
      "models": [
        {
          "slug": "claude-fable-5-1",
          "name": "Claude Fable 5.1",
          "shortName": "Fable 5.1",
          "aliases": ["fable", "fable-5.1", "claude-fable-5.1"],
          "status": "current", // "legacy" sets isLegacy
          "profile": "fable-5-1",
          // CLI version compatibility gate:
          "adapter": { "claudeCode": { "minVersion": "2.1.257" } },
        },
      ],
    },
  },
}
```

Semantics of the Claude adapter payloads:

- `effortMap` — remaps a resolved effort selection before it reaches the
  Claude CLI `--effort` flag; `null` means "pass no flag". `ultrathink` is
  always dropped regardless (prompt-prefix mode), and `ultracode` is dropped
  for models without a mapping.
- `modelSuffixes` — per-option-value api-model-id suffixes (the `[1m]`
  context-window suffix today).
- `contextWindowTokens` / `fixedContextWindowTokens` — kept for upstream
  format parity; Ryco reads live window sizes from runtime usage events.
- model `adapter.claudeCode.minVersion` / `maxVersionExclusive` — hide the
  model on incompatible Claude Code versions. The provider check surfaces an
  upgrade message naming the model with the lowest unmet minimum.

## Adding a model

1. Add a profile (or reuse one) and a `models` entry with the version gate.
2. Validate locally: `bun run test src/provider/ModelManifest.test.ts
src/provider/ClaudeModelCatalog.test.ts` in `apps/server` (the first test
   decodes the bundled file).
3. Merge to `main`. Running installs pick it up on their next provider check
   after the TTL window; releases bundle it.

Code map: `ModelManifest.ts` (schema, fetch/cache service),
`ClaudeModelManifest.ts` (adapter payload schemas), `ClaudeModelCatalog.ts`
(catalog resolution, version gating, effort/suffix mapping, and the active
catalog used by adapter-side call sites), `Layers/ClaudeProvider.ts`
(provider check + backwards-compatible wrappers).

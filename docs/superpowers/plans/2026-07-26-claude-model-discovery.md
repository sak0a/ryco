# Automatic Claude Model Discovery Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-26-claude-model-discovery-design.md`

## Scope

Use Claude Agent SDK initialization models as the authoritative per-instance
inventory, retain the last successful inventory for transient failures in the
same provider instance, keep static models as the cold fallback and exact-slug
Ryco metadata overlay, and make discovered runtime options effective.

## Task 1: Map SDK models in `ClaudeProvider`

Files:

- Modify `apps/server/src/provider/Layers/ClaudeProvider.ts`
- Modify `apps/server/src/provider/Layers/ProviderRegistry.test.ts`

Steps:

1. Extend `ClaudeCapabilitiesProbe` with a discovered model array.
2. Add a pure `ModelInfo` mapper that validates identifiers/names, deduplicates
   by identifier, builds effort and fast-mode descriptors from SDK metadata,
   and overlays only exact-slug Ryco extras.
3. Add a per-instance inventory state object that records successful discovery,
   resolves the latest/last/static fallback order, and resolves capabilities by
   exact model slug.
4. Make `checkClaudeProviderStatus` select discovered models before merging
   configured custom models.
5. Keep static version filtering and upgrade messages only on the cold fallback
   path.
6. Add tests for unknown Opus 5 mapping, authoritative replacement, custom
   merging, empty discovery, retained fallback, and cold static fallback.

## Task 2: Preserve authoritative Claude inventory in aggregation

Files:

- Modify `apps/server/src/provider/Layers/ProviderRegistry.ts`
- Modify `apps/server/src/provider/Layers/ProviderRegistry.test.ts`

Steps:

1. Make Claude provider snapshots replace their prior model list because
   `ClaudeProvider` has already selected discovery or fallback.
2. Leave the existing defensive merge behavior unchanged for other drivers.
3. Test that cached/static Claude models are removed by a successful dynamic
   inventory, including an authoritative empty inventory.

## Task 3: Use discovered capabilities at runtime

Files:

- Modify `apps/server/src/provider/Drivers/ClaudeDriver.ts`
- Modify `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- Modify `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`
- Modify `apps/server/src/textGeneration/ClaudeTextGeneration.ts`
- Modify `apps/server/src/textGeneration/ClaudeTextGeneration.test.ts`

Steps:

1. Create one model inventory state per Claude driver instance before creating
   its adapter and text-generation service.
2. Pass an instance-scoped capability resolver to both runtime paths.
3. Replace static capability lookups at turn construction, prompt-prefix
   handling, and CLI text generation with that resolver.
4. Retain the static resolver as the default for direct construction and
   existing tests.
5. Add tests proving a dynamically discovered model forwards SDK effort and
   fast mode.

## Task 4: Remove primary-path release maintenance

Files:

- Modify `apps/server/src/provider/Layers/ClaudeProvider.ts`
- Modify `apps/server/src/provider/Layers/ProviderRegistry.test.ts`

Steps:

1. Do not apply CLI version gates or release upgrade messages after successful
   discovery.
2. Keep only fallback-safety gates that are exercised when no discovery has
   succeeded.
3. Remove or narrow tests that assume the static release catalog is the normal
   ready-state inventory.

## Task 5: Verify

Run targeted Claude provider, adapter, text-generation, and registry tests
first. Then run:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
```

This change does not alter browser interaction, responsive layout, PWA
behavior, browser lifecycle, or hosted reconnect behavior, so the browser
suite is not required.

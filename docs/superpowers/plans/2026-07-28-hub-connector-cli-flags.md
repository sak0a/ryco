# Hub connector CLI flags implementation plan

**Goal:** Expose the three ordinary outbound Hub connector startup settings as typed server CLI
flags while preserving environment-variable fallback and centralized fail-closed validation.

**Design:** `docs/superpowers/specs/2026-07-28-hub-connector-cli-flags-design.md`

## Task 1: Add typed shared server flags

- Modify `apps/server/src/cli.ts`.
- Define optional presence-style flags for connector enablement and permissioned-file fallback.
- Define an optional string flag for the Hub origin.
- Add all three flags to the shared server command surface used by the root, `start`, and `serve`
  commands.
- Extend normalized server flags without duplicating Hub configuration validation.

## Task 2: Resolve CLI values before environment values

- Modify `apps/server/src/cli.ts`.
- Convert present boolean flags to the raw exact `"true"` representation expected by
  `resolveHubConnectorConfig`.
- Resolve each new field independently with CLI-over-environment precedence.
- Leave reconnect timing and jitter configuration environment-only.
- Preserve the existing defaults and `configuration_invalid` behavior.

## Task 3: Add focused regression coverage

- Modify `apps/server/src/cli-config.test.ts`.
- Verify environment-only behavior when flags are absent.
- Verify presence-style booleans override environment `false`.
- Verify standard negative boolean forms override environment `true`.
- Verify the CLI origin overrides the environment origin.
- Verify mixed flag/environment configuration.
- Verify an invalid CLI origin fails closed without reflecting its input.
- Add CLI parser or help coverage proving the root, `start`, and `serve` commands accept the flags.

## Task 4: Document both startup surfaces

- Modify `docs/hub-connector.md`.
- Add the three CLI equivalents and document precedence.
- Include a public-safe, placeholder-only `ryco serve` example.
- Keep the prohibition on command-line secrets explicit.

## Task 5: Validate

- Run focused server CLI tests.
- Run:

  ```sh
  bun fmt
  bun run fmt:check
  bun lint
  bun typecheck
  bun run typecheck:effect
  bun run test
  bun run build
  ```

- Review the final diff for public-scope safety, generated files, and whitespace errors.

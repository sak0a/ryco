# Hub connector CLI flags design

## Context

Ryco's outbound Hub connector is configured through environment variables. This works well for
managed deployments, but it makes an otherwise self-contained `ryco serve` invocation depend on
shell-specific environment syntax. The three settings needed for ordinary node startup should also
be available as discoverable CLI flags.

The environment variables remain supported. This change adds an equivalent CLI surface without
changing connector behavior, enrollment, identity custody, relay protocol, or Hub requirements.

## Goals

- Add presence-style CLI flags for enabling the connector and allowing the permissioned-file secret
  store fallback.
- Add a value-taking CLI flag for the canonical Hub origin.
- Preserve the current environment-variable configuration when the new flags are omitted.
- Give an explicitly supplied CLI flag precedence over its corresponding environment variable.
- Expose the flags consistently on the root server command, `start`, and `serve`.
- Keep validation and fail-closed behavior centralized in the existing Hub connector configuration
  resolver.

## Non-goals

- Exposing reconnect timing or jitter settings as CLI flags.
- Adding a persistent Hub connector configuration file.
- Adding custom boolean aliases beyond the CLI library's standard positive and `--no-…` forms.
- Accepting credentials, enrollment material, keys, proofs, tickets, or secrets on the command
  line.
- Changing the relay protocol or requiring an intermediary change.

## CLI interface

The shared server command flags gain:

| Flag                            | Value        | Environment fallback               |
| ------------------------------- | ------------ | ---------------------------------- |
| `--hub-connector-enabled`       | Presence     | `RYCO_HUB_CONNECTOR_ENABLED`       |
| `--hub-origin <origin>`         | String value | `RYCO_HUB_ORIGIN`                  |
| `--hub-allow-file-secret-store` | Presence     | `RYCO_HUB_ALLOW_FILE_SECRET_STORE` |

The positive boolean flags resolve to `true` when present. The CLI library also supplies its
standard `--no-hub-connector-enabled` and `--no-hub-allow-file-secret-store` forms for an explicit
`false` override. When neither form is present, the environment variables retain the existing exact
`true` or `false` parsing. The origin flag remains a string until it reaches the existing
canonical-origin resolver so invalid origins continue to produce `configuration_invalid` without
reflecting sensitive input.

An invocation can therefore configure the ordinary startup surface entirely with flags:

```sh
ryco serve \
  --hub-connector-enabled \
  --hub-origin https://hub.example.test \
  --hub-allow-file-secret-store \
  --host 127.0.0.1 \
  --port 3774 \
  --base-dir /path/to/node-state \
  /path/to/workspace
```

## Configuration precedence

Each new field resolves independently:

1. Explicit positive or negative CLI flag.
2. Corresponding environment variable.
3. Existing default in `resolveHubConnectorConfig`.

This permits mixed configuration, such as supplying the origin through the environment while
enabling the connector with a CLI flag. Omitted flags never erase environment configuration.

The connector still fails closed when enabled without a valid canonical origin or when any
environment-only reconnect setting is invalid.

## Implementation boundaries

`apps/server/src/cli.ts` owns the new flag definitions, optional fields, shared command exposure,
and CLI-over-environment selection. The selected values are converted into the raw string shape
already consumed by `resolveHubConnectorConfig`.

`apps/server/src/config.ts` remains the sole owner of Hub connector defaults, canonical origin
validation, bounded reconnect settings, and `configuration_invalid` behavior. No parsing or
validation logic is duplicated in the CLI.

`docs/hub-connector.md` documents both configuration surfaces and their precedence.

## Security and diagnostics

The new flags contain only non-secret operational configuration. Existing rules prohibiting
credentials and key material in command-line arguments remain unchanged.

CLI parsing and configuration errors must not echo rejected Hub origins. Runtime diagnostics
continue exposing only the bounded connector status model.

`--hub-allow-file-secret-store` only permits the existing hardened POSIX fallback when the OS
protected store is unavailable. It does not change file permissions, storage paths, or secret-store
selection order.

## Testing

Focused CLI configuration tests cover:

- environment-only configuration when all three flags are absent;
- each presence-style boolean overriding an environment value of `false`;
- `--hub-origin` overriding a different environment origin;
- mixed flag and environment configuration;
- invalid CLI origin preserving fail-closed `configuration_invalid` behavior; and
- omitted flags preserving the existing disabled defaults.

CLI help or parser coverage confirms that the flags are accepted by the root, `start`, and `serve`
commands. Documentation examples use only non-private placeholder origins and paths.

After focused tests, the full repository formatting, lint, TypeScript, Effect TypeScript, test, and
build backstops run before completion.

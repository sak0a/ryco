# Claude Reasoning-Level Parity

## Goal

Bring Ryco's static Claude reasoning choices into parity with the current T3Code catalog for Claude
Fable 5 and Claude Sonnet 4.6, without changing unrelated context-window, fast-mode, lifecycle, or
model-visibility behavior.

## Design

- Add `ultracode` to Claude Fable 5 after `max` and before the prompt-injected `ultrathink`
  choice. Preserve `high` as the default.
- Normalize Fable 5 `ultracode` to the Claude CLI and Agent SDK `xhigh` effort while also enabling
  the existing `settings.ultracode` flag.
- Add `max` to Claude Sonnet 4.6 after `high` and before `ultrathink`. Preserve `high` as the
  default.
- Normalize Sonnet 4.6 `max` to the SDK-supported `high` effort. The user-visible selection remains
  `max`; only the provider transport value is adapted for compatibility.
- Keep capability ownership in `ClaudeProvider.ts` and reuse the existing descriptor, selection,
  prompt-injection, and trait-rendering paths. No contracts or client-specific UI changes are
  required.
- Do not synchronize unrelated differences from T3Code's Claude catalog as part of this change.

## Error Handling and Compatibility

The existing capability resolver continues to reject unsupported saved selections by falling back
to each model's default. Model-aware normalization happens only after resolution, so custom models
and other built-in Claude models retain their existing behavior. `ultrathink` remains a prompt-only
mode and is not forwarded as an SDK or CLI effort.

## Testing

Extend the existing Claude provider and adapter coverage to verify:

- Fable 5 advertises low, medium, high, xhigh, max, ultracode, and ultrathink, with high as the
  default.
- Fable 5 Ultracode is sent as `xhigh` with `settings.ultracode: true` through the Agent SDK and is
  normalized to `xhigh` for CLI consumers.
- Sonnet 4.6 advertises Max and converts that selection to SDK/CLI effort `high`.
- Existing defaults and prompt-injected Ultrathink behavior remain unchanged.

Run the full repository backstop required by `AGENTS.md`. Because the descriptor changes affect web
interaction, also build `@ryco/web` and run the browser suite.

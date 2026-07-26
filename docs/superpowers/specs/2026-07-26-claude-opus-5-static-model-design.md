# Static Claude Opus 5 Model Support

## Goal

Add Claude Opus 5 to Ryco's existing static Claude model inventory without introducing SDK model
discovery or changing provider inventory ownership.

## Design

- Register `claude-opus-5` as `Claude Opus 5` (`Opus 5`) in `BUILT_IN_MODELS`.
- Reuse the Opus 4.8 effort choices: low, medium, high, xhigh, max, ultracode, and ultrathink.
- Expose fast mode and the 200k/1M context-window selector.
- Match the upstream T3Code entry by making 1M the default context window for Opus 5.
- Normalize Opus 5 ultracode to the Claude CLI/SDK `xhigh` effort in the same way as Opus 4.8.
- Gate the model on Claude Code version `2.1.219` and include the normal upgrade guidance on older
  versions.
- Preserve user-configured custom models through the existing merge path.

## Testing

Extend the existing Claude provider registry tests to cover:

- Opus 5 visibility at version `2.1.219`.
- The full effort list, high default effort, fast mode, and 1M-default context window.
- Opus 5 being hidden with an upgrade message on version `2.1.218`.
- Ultracode normalization for Opus 5.

Run the repository's required formatting, lint, typecheck, test, and build backstop.

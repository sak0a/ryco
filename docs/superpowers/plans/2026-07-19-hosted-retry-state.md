# Hosted Retry State Ownership Implementation Plan

**Goal:** Prevent generic Effect RPC retries from falsely changing a healthy hosted relay transport
to `reconnecting`, while preserving state transitions and recovery for genuine relay failures.

**Design spec:** `docs/superpowers/specs/2026-07-19-hosted-retry-state-design.md`

## Execution rules

- Work only on `fix/hosted-retry-state` in the public repository.
- Add the regression test before changing production behavior and confirm the expected failure.
- Never run `bun test`; use `bun run test`.
- Keep retry timing, relay schemas, tickets, authorization, request replay, and wire behavior intact.
- Include no private infrastructure, issue references, identifiers, or staging evidence.

## Task 1: Add red state-ownership coverage

**File:** `apps/web/src/hostedHub/transport.test.ts`

- [ ] Replace the expectation that `getReconnectDelayMs()` emits `reconnecting` with a test that
      establishes an online active generation, invokes the callback, and proves state stays online.
- [ ] Preserve coverage that reset or obsolete-generation callbacks cannot alter current state.
- [ ] Add or tighten coverage showing non-intentional close and classified socket/ticket failures
      still own real reconnecting or terminal transitions.
- [ ] Run the focused test and confirm it fails only because the delay callback mutates state.

## Task 2: Remove the generic retry side effect

**File:** `apps/web/src/hostedHub/transport.ts`

- [ ] Remove only the status mutation from `getReconnectDelayMs()`.
- [ ] Preserve reconnect delay calculation and one-shot server `Retry-After` consumption.
- [ ] Preserve generation scoping, connection-close handling, delivery-unknown behavior, and all
      ticket and authorization boundaries.
- [ ] Run the focused hosted transport suite and confirm it passes.

## Task 3: Run public gates and publish

- [ ] Run `bun fmt`, `bun run fmt:check`, `bun lint`, `bun typecheck`, and
      `bun run typecheck:effect`.
- [ ] Run `bun run test`, `bun run build`, the hosted browser test, and release smoke gate.
- [ ] Inspect the complete diff, schema/fixture status, and output for private or sensitive data.
- [ ] Commit the implementation conventionally, push the public branch, open a focused PR, and wait
      for CI and review before merging.

## Private follow-up boundary

Pinning a merged public commit in another repository or deploying it is separate work. This plan
does not authorize any infrastructure mutation.

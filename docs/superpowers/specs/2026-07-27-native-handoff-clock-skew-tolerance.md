# Native handoff clock-skew tolerance

- **Status:** Approved, 2026-07-27.
- **Scope:** shared native-handoff client validation and focused tests.

## Problem

The Hub returns a native handoff expiry exactly five minutes after its own
clock. The client currently compares that timestamp with its local clock and
rejects any value beyond an exact five-minute local ceiling. Even negligible
positive Hub clock skew can therefore reject an otherwise valid start response
before the system browser opens.

## Design

Keep the protocol's five-minute transaction lifetime unchanged. The shared
client runtime accepts a start expiry when its remaining lifetime, measured
against the device clock, is within 60 seconds below zero or within 60 seconds
above the five-minute lifetime. This is a validation tolerance only; it does
not change the expiry minted or enforced by the Hub.

The same 60-second tolerance applies when the browser returns. A device clock
that is slightly ahead must not prevent redemption, while the Hub remains the
authoritative expiry check. Values outside the tolerance fail closed with the
existing bounded `expired` or `authorization_rejected` errors.

The tolerance remains private to `packages/client-runtime`. It does not change
the public schema or introduce configuration.

## Verification

Focused tests cover:

- a start response at the five-minute lifetime plus exactly 60 seconds;
- a start response one millisecond beyond that upper bound;
- an expiry up to exactly 60 seconds behind the device clock;
- an expiry more than 60 seconds behind the device clock; and
- a browser callback accepted at the tolerated boundary but rejected after it.

The complete repository validation remains required after the focused tests.

# Hosted Canonical Environment Identity

## Problem

A hosted connection has two legitimate identifiers:

- the Hub-issued environment identifier used to select and authorize a node; and
- the server-local environment identifier reported by lifecycle and configuration payloads.

The hosted runtime registers its primary connection under the Hub-issued identifier. After the
connection opens, `RootAppShell` currently replaces the primary descriptor and active environment
with the server-local identifier. Consumers such as project creation and filesystem browsing then
look up an environment connection under an identifier that the supervisor never registered. The
operation fails before an RPC is sent even though the relay is healthy.

Direct and saved-environment connections do not have this split and must retain their current
behavior.

## Decision

The Hub-issued environment identifier is the canonical client-side identifier for the lifetime of
a hosted node selection.

Server lifecycle and configuration payloads remain authoritative for server-owned metadata and
bootstrap content, but their server-local environment identifier must not replace the canonical
hosted identifier. Direct and saved connections continue to use the server-reported identifier.

Aliasing one connection under both identifiers is rejected because it would allow duplicated
environment state and make cleanup, reconnect generations, routing, and mutation authority
ambiguous. Replacing either persistent identity system is also out of scope because both identifiers
have independent ownership and persistence requirements.

## Design

Add a small pure resolver beside the existing `RootAppShell` logic. It accepts:

- whether the shell is running under hosted lifecycle ownership;
- the current primary descriptor identifier; and
- the server-reported identifier.

For direct mode it returns the server-reported identifier. For hosted mode it returns the current
primary descriptor identifier and returns no identifier if the hosted lifecycle has not published
one yet. It must not fall back to the server-local identifier in hosted mode because doing so would
publish state under an unauthorized or stale identity during a lifecycle race.

`RootAppShell` will receive the hosted status it already derives from the authentication gate and
use the resolver for both lifecycle welcome events and configuration snapshots.

In hosted mode:

- lifecycle and configuration events do not overwrite the primary descriptor;
- the active environment is set to the resolved Hub identifier;
- shell bootstrap state, project keys, scoped project/thread references, and navigation use the
  resolved Hub identifier; and
- an event arriving before the hosted descriptor exists performs no identity-dependent mutation.
  The hosted lifecycle remains responsible for publishing the descriptor and creating the
  connection.

In direct mode, descriptor updates, active-environment selection, bootstrap, and navigation remain
unchanged.

No relay protocol, Hub API, server enrollment, or filesystem RPC changes are required.

## Testing

Unit tests for the resolver will prove:

- direct mode uses the server identifier;
- hosted mode uses the Hub descriptor identifier even when the server identifier differs; and
- hosted mode does not fall back when the descriptor is unavailable.

A component-level regression test will exercise a hosted lifecycle/config update with differing
identifiers and verify that the primary descriptor and active environment retain the Hub identity.
The existing filesystem-browse connection-subscription tests continue to cover reconnection after
the canonical connection becomes available.

Validation follows the repository backstop. Because this changes hosted browser lifecycle behavior,
it also includes the web build and browser suite.

## Rollout

The fix lands in the public Ryco repository. A hosted deployment consumes it by updating the
vendored Ryco revision; the private Hub application requires no behavior change. Live verification
will select a hosted node, open project creation, browse multiple directories, and create or add a
project without a reconnect error.

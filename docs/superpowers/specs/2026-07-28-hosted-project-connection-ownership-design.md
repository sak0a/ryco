# Hosted Project Connection Ownership Design

**Status:** Approved

**Date:** 2026-07-28

## Summary

Hosted project browsing, creation, and clone destination selection can report that the environment
is unavailable while the routed node is online and its relay channel is carrying successful RPC
traffic. The filesystem picker then renders a reconnecting error and does not send a
`filesystem.browse` request.

The repair will make the hosted lifecycle's current primary environment connection the only source
of connection-bound RPC clients. Browser-local API access must not retain or create a competing
primary client across hosted generations. Project flows will consume the authoritative connection
and continue using the connection-aware retry behavior added previously.

## Evidence and failure boundary

Live qualification established the following sequence:

1. the hosted node reports online and has an active relay channel;
2. the browser authenticates, opens a channel, subscribes to the shell, and exchanges successful
   RPC responses;
3. source-control discovery succeeds;
4. opening the local-folder picker reports that the environment is temporarily unavailable; and
5. no `filesystem.browse` RPC is emitted.

The relay channel remains open and continues exchanging application and relay heartbeats. The
failure therefore occurs before filesystem RPC dispatch. It is not an oversized-frame close, a
relay transport failure, a filesystem permission error, or a server-side browse failure.

The web runtime currently exposes two ways to obtain connection-bound behavior:

- the environment supervisor publishes the lifecycle-owned current connection; and
- the cached browser-local API can close over a primary RPC client obtained earlier.

A hosted disconnect, revalidation, or connection replacement can invalidate the latter without
invalidating the cached API object. Conversely, reading the local API can create a primary
connection outside the intended hosted activation path. This violates the single-owner hosted
lifecycle boundary and lets adjacent features observe different effective clients.

The implementation will first encode this live sequence as a failing integration regression. If
that regression disproves split connection ownership as the cause, production behavior will not be
changed until the failing boundary is identified and the design is amended.

## Goals

- Keep one authoritative primary RPC client for the current hosted generation.
- Prevent browser-local API caching from retaining a disposed or superseded hosted client.
- Prevent generic local API access from creating a hosted primary connection.
- Make filesystem browsing retry against the current lifecycle-owned connection.
- Keep project creation and clone destination selection on the same current connection.
- Preserve direct, saved-environment, desktop, and native behavior.
- Preserve relay framing, authentication, authorization, role, ticket, and snapshot-readiness
  policy.

## Non-goals

- Changing Hub relay or control-plane protocols.
- Weakening hosted mutation-readiness checks.
- Adding filesystem sandboxing.
- Changing project path semantics or automatic project bootstrap behavior.
- Redesigning source-control provider setup.
- Deploying or qualifying a hosted environment from the public repository change.

## Considered approaches

### Repair authoritative connection ownership (selected)

Connection-bound browser APIs resolve the current supervisor-owned primary client. Hosted mode does
not create a primary client through generic local API access, and cached APIs cannot retain a
superseded client. Project browsing observes connection replacement and retries using the new
client.

This fixes the shared lifecycle defect and protects other connection-bound actions from the same
failure class.

### Pass an API object only through the folder picker

The command palette could capture an API when the source-selection step opens and pass it directly
to filesystem browsing. This is smaller, but it can preserve a stale client through reconnect and
does not repair other consumers of the cached local API.

### Hide project actions until the environment is ready

The UI could disable browsing, creation, and cloning whenever the current API lookup fails. This
avoids an immediately broken dialog but does not repair split connection ownership or guarantee
recovery after a generation change.

## Architecture

### Authoritative client access

The environment supervisor remains the registry for the current primary and saved-environment
connections. Hosted activation and deactivation remain the only owners allowed to connect or
disconnect the hosted primary environment.

Browser-local APIs are divided conceptually into:

- platform-stable operations, such as dialogs, persistence, context menus, and external links; and
- connection-bound operations, such as server discovery and backend shell requests.

Platform-stable operations may remain cached. Connection-bound operations must resolve the current
supervisor connection when invoked, or return the existing bounded unavailable error when no
authoritative connection exists. They must not close over a client from an earlier hosted
generation.

In hosted mode, generic local API reads must never call a helper that creates or registers a
primary connection. Direct and desktop modes retain their existing startup behavior.

### Filesystem browsing

`useFilesystemBrowse` continues to subscribe to environment-supervisor changes. Its active browse
scope is tied to the exact current connection identity. When that identity appears or changes, the
hook retries the same browse key.

The browse controller:

- treats a missing current connection as retryable unavailable state;
- does not mark unavailable state as fresh cached data;
- retains prior successful entries while reconnecting;
- rejects responses from superseded fetch tokens; and
- only caches a successful `filesystem.browse` result.

The request must use the same authoritative connection identity that triggered the retry instead of
performing an unrelated second lookup that can race with replacement.

### Project creation and cloning

Manual project creation resolves the current environment API at submission time and preserves the
existing visible unavailable error if readiness was lost.

Clone flows continue passing the API that completed the clone into project registration. Clone
destination browsing uses the same authoritative connection rules as local-folder browsing.

### Hub integration boundary

The public Ryco repair is implemented and reviewed independently. After it merges, the Hub
repository may update its vendored public Ryco pin and generated application bundle in a separate
change. No Hub application logic or relay intermediary change is expected.

## Data flow

```text
hosted node activation
  -> hosted lifecycle writes current environment descriptor
  -> hosted lifecycle creates and registers one primary connection
  -> shell snapshot for current generation becomes ready
  -> project action opens
  -> browse hook observes the registered connection identity
  -> filesystem.browse uses that exact connection
  -> successful entries are cached and rendered

hosted connection replacement
  -> lifecycle removes and disposes the old connection
  -> connection-bound local API calls become temporarily unavailable
  -> lifecycle registers the replacement connection
  -> browse subscription observes the new identity
  -> active browse retries with the replacement client
```

## Error handling

- A missing authoritative connection produces the existing bounded reconnecting message.
- A server browse failure remains distinct and preserves any prior successful entries.
- A superseded generation or fetch token cannot publish data, readiness, or errors.
- No retry path creates a second hosted connection.
- No RPC payload, filesystem entry, credential, ticket, or private identifier is logged.

## Testing

### Focused runtime tests

- Prove a browser-local API created before hosted replacement does not retain the old client.
- Prove generic local API access cannot create a hosted primary connection.
- Prove direct and desktop modes still obtain their primary backend normally.
- Prove platform-stable local API operations remain available without a backend connection.

### Hosted lifecycle integration

- Activate a hosted node and accept the current shell snapshot.
- Open or resolve the connection-bound API.
- Replace the hosted generation.
- Assert the old connection is disposed, only one current connection is registered, and later API
  calls use the replacement.
- Assert stale generations cannot republish readiness or mutation authority.

### Project-flow coverage

- Reproduce an unavailable browse followed by connection publication and automatic retry.
- Assert the retry sends `filesystem.browse` through the replacement client.
- Cover local-folder browsing and clone destination browsing.
- Preserve the visible manual-add error when readiness disappears at submission time.
- Add browser coverage for opening the picker during reconnect and seeing directory entries appear
  without reopening it.

### Repository backstop

Run the complete repository validation required by `AGENTS.md`, including the web build and browser
suite because hosted browser lifecycle behavior changes.

## Rollout and qualification

1. Merge the public Ryco repair.
2. Update the Hub repository's public Ryco pin and generated bundle in a separate pull request.
3. Restart the qualification node from the merged build.
4. Reload or apply the hosted PWA update.
5. Verify folder listing, manual project creation, and repository clone destination selection over
   a live relay.
6. Verify a directory response larger than one relay data frame remains usable and does not close
   the channel.

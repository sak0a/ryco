# Agent Control project and settings governance

Agent Control project mutations use the same immutable proposal, approval,
executor, orchestration-command, and audit lifecycle as thread mutations. MCP
handlers only prepare and submit plans. They never dispatch a project command,
write a projection, or touch workspace contents.

## Project operations

- `createProject` links one existing authorized directory. Its plan fixes the
  project id, display name, canonical workspace root, metadata directory, and
  repository identity. Execution dispatches `project.create` with directory
  creation disabled.
- `updateProject` changes only the display name and/or canonical workspace root.
  The plan records exact before/after values, repository identities, and the
  expected `updatedAt` revision.
- `removeProject` unlinks the Ryco project record. The plan records the exact
  project state and exact thread ids. `force` must be explicit when Ryco thread
  records would also be removed. The executor dispatches `project.delete`; it
  never calls a filesystem removal API and never deletes the repository or
  working directory.

Preparation and execution both apply the existing workspace access policy,
workspace normalization, repository identity, projection snapshot, and caller
project-scope checks. Execution revalidates the exact project revision, paths,
repository identity, thread set, and target availability.

## Settings allowlist and current prerequisite

The typed non-secret allowlist is deliberately limited to:

- `legacyTokenStreaming` (`enableLegacyTokenStreaming`)
- `providerUpdateChecks` (`enableProviderUpdateChecks`)

The settings summary exposes only these boolean values and marks mutation as
unsupported. The current node can require an owner role for the approval RPC,
but it cannot carry authoritative, fresh reauthentication evidence from that
approval into executor-time revalidation. Consequently settings changes fail
closed before proposal persistence, again at approval if a proposal was
created through an internal trusted service, and again during execution. No
setting is mutated until an owner step-up authority with freshness and replay
semantics exists at both boundaries.

The allowlist structurally excludes secrets and credentials; provider command,
environment, and connection configuration; MCP server command, URL, and auth
configuration; remote, relay, hosted-Hub, authentication, filesystem-root, and
network-exposure configuration; Agent Control policy; and all other settings.
There is no generic key/value or JSON-patch settings interface.

## Audit and approval presentation

The immutable proposal row retains the exact approved plan and terminal result.
Append-only audit rows reference that proposal and digest while retaining
requester/provider identity, timestamps, decision transitions, operation id,
outcome, and bounded non-secret action metadata. Web and mobile use the shared
client-runtime presentation model to show exact project/settings values;
project unlink proposals are explicitly destructive and state that workspace
contents are retained.

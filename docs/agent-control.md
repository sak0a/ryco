# Agent Control

Agent Control lets coding agents inspect Ryco and request work. Read operations are scoped and
redacted. A mutation never happens merely because an agent called a tool: Ryco creates an immutable
request and waits for a user to approve it.

## Ryco sessions versus standalone clients

There are two connection paths.

### Ryco-managed sessions

When Agent Control is enabled, supported provider sessions started by Ryco receive it automatically.
There is nothing to install in the provider's persistent MCP configuration. Access is private,
runtime-scoped, and revoked with the session or turn that received it.

The Integrations page reports this under **Ryco sessions**. Its purpose is to show which configured
providers support automatic access and which do not.

### Standalone provider clients

A Codex, Claude Code, Copilot, Cursor, Grok, or supported OpenCode client started outside Ryco needs
a durable external connection. Under **Standalone provider clients**, choose a detected provider
profile and select **Connect**. Ryco will:

1. create a separately scoped external integration;
2. store its credential in Ryco's private owner-readable runtime directory;
3. add a credential-free stdio bridge entry through that provider's native MCP authority;
4. re-read the native entry; and
5. launch the installed command, negotiate MCP, and verify the Agent Control tool catalog.

The installation is shown as connected only after all five steps succeed. The browser, provider
configuration, logs, and child-process environment never receive the raw credential.

The default connection can list allowed projects, request one task at a time, and read or wait for
tasks created by that integration. It covers current and future projects, allows 60 control calls
per minute, and has no expiry. Every requested Ryco mutation still needs approval.

## Repair and disconnect

Use **Repair** after an interrupted install, a missing credential file, or a failed protocol check.
Ryco revalidates durable state and replaces only missing material or configuration it still owns.
Incomplete installations are also reconciled after a server restart.

Use **Disconnect** to revoke the external integration and remove its private credential. Ryco removes
the provider entry only when its current fingerprint still matches the installed version. If you
edited that entry, Ryco preserves it and reports that manual cleanup remains.

If both `ryco` and `ryco-agent-control` already name unrelated MCP servers, Ryco reports a conflict
instead of overwriting them. Rename one of those entries in the provider's native configuration and
retry.

## Manual setup

Advanced manual pairing remains available for unsupported clients or configuration environments
Ryco cannot mutate safely. It creates the same external security principal but requires you to run
the displayed pairing command and copy the generated MCP entry yourself. Pairing codes are
short-lived; do not place them or the resulting credential in provider configuration.

Provider-specific MCP behavior is documented in [Provider MCP management](./providers/mcp.md).

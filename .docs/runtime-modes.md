# Runtime modes

Ryco has a global runtime mode switch in the chat toolbar:

- **Supervised** (`approval-required`): uses read-only sandboxing and asks before commands or file changes. Codex maps this to `approvalPolicy: untrusted` and `sandboxMode: read-only`.
- **Auto-accept edits** (`auto-accept-edits`): allows workspace edits but asks before other actions. Codex maps this to `approvalPolicy: on-request` and `sandboxMode: workspace-write`.
- **Full access** (`full-access`, default): allows commands and edits without prompts. Codex maps this to `approvalPolicy: never` and `sandboxMode: danger-full-access`.

Ryco also has an interaction mode switch:

- **Build** (`default`): normal implementation mode.
- **Plan** (`plan`): planning-oriented provider instructions where supported.

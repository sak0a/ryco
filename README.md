<div align="center">

<img src="./assets/ryco-logo.png" width="128" alt="Ryco" />

# Ryco

**A fast local workspace for coding agents.**

Codex · Claude · GitHub Copilot · OpenCode · Cursor (Early Access)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg?style=flat-square)](https://github.com/sak0a/ryco/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3-fbf0df.svg?style=flat-square&logo=bun&logoColor=black)](https://bun.sh)
[![Electron](https://img.shields.io/badge/Electron-40.9-47848f.svg?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2.svg?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/jn4EGJjrvv)

</div>

---

## What is Ryco?

Ryco is a small, practical workspace for AI coding agents. It runs Codex, Claude, GitHub Copilot, OpenCode, and early-access Cursor side by side, with fast local workflows, clear per-provider customization, and visibility into provider behavior.

It ships as a cross-platform desktop app (macOS, Linux, Windows) and as a local web CLI backed by an Effect/TypeScript server and a React/TanStack UI.

## Features

### Coding agents

- **Codex** — via Codex app-server, with usage windows surfaced in the UI
- **Claude** — via the Claude Agent SDK, including usage windows when available
- **GitHub Copilot** — via `@github/copilot-sdk`
- **OpenCode** — via `@opencode-ai/sdk` or a configured OpenCode server URL
- **Cursor** _(Early Access)_ — via the Cursor Agent ACP runtime
- Multiple **named provider instances** per driver (e.g. `codex_personal`, `claude_openrouter`) with independent config, environment variables, auth identity, model preferences, and accent colors

### Workflow

- **Git worktree management** — create and track worktrees per branch, PR, issue, or Jira work item, with status buckets (idle, in_progress, review, done)
- **Multi-terminal drawer** — split terminals, custom tabs, clickable file & path links; the chat-bar toggle button reflects open/closed state
- **Composer attachments** — attach GitHub, GitLab, Forgejo, Bitbucket, or Azure DevOps issues and pull/merge requests as structured turn context (`#` keyboard trigger). Title, body, metadata, and recent comments are forwarded to the agent
- **Diff panel with occurrence search** — fast navigation inside large changes
- **Diff line click → editor** — opens your configured editor at the exact file and line
- **Default editor memory** — remembers your preferred editor for opening workflows
- **Symlink-aware project paths** — Dropbox-on-macOS and other symlinked roots are recognized as the same workspace whether opened from `/Users/you/Dropbox/...` or `/Users/you/Library/CloudStorage/Dropbox/...`
- **Thread workspace panel** — browse files, review diffs, and jump between workspace/review/terminal views without leaving the thread

### UI & customization

- **Custom themes** — full theme editor with live preview, import/export, and a reusable color picker component
- **Keybindings** — customizable shortcuts for terminal toggle, diff toggle, new chat, script execution, and more (see [KEYBINDINGS.md](./KEYBINDINGS.md))
- **Command palette** — searchable commands with thread and model jump bindings (`Cmd+K`)
- **Lexical-based prompt composer** — rich editing with formatting
- **Preview panel** — syntax-highlighted diffs with file-tree navigation
- **Project favicon resolver** — auto-detected per-project icons in the sidebar
- **Branch toolbar** — branch selector plus local/worktree environment selector integration
- **Project folders and grouped repositories** — organize local and remote projects in the sidebar

### Integrations & infrastructure

- **MCP server support** — Model Context Protocol built in, with workspace-level configuration
- **Source-control and work-item providers** — GitHub, GitLab, Forgejo/Codeberg, Azure DevOps, Bitbucket, plus Jira project/work-item workflows. See [docs/source-control-providers.md](./docs/source-control-providers.md)
- **Remote environments** — saved HTTP/WebSocket environments, pairing links/sessions, SSH utilities, and Tailscale endpoint/Serve helpers
- **Auto-updates** — `electron-updater` with in-app update notifications in the sidebar
- **Observability** — local trace files, provider event logs, and optional OTLP trace/metric export. See [docs/observability.md](./docs/observability.md)

## Install

> [!WARNING]
> Install and authenticate at least one provider before use:
>
> - **Codex** — install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - **Claude** — install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - **OpenCode** — install [OpenCode](https://opencode.ai) and run `opencode auth login`
>
> GitHub Copilot and Cursor are also supported when their provider CLIs/accounts are available on the machine running Ryco. Check **Settings → Providers** for live auth and version status.

### Run without installing

```bash
npx ryco-cli
```

### Desktop app

Get the latest installer from [GitHub Releases](https://github.com/sak0a/ryco/releases) or use a package manager:

| Platform | Format              | Install                                 |
| -------- | ------------------- | --------------------------------------- |
| macOS    | `.dmg` (arm64, x64) | Run `Install Ryco.command` from the DMG |
| Linux    | `.AppImage` (x64)   | `yay -S ryco-bin` (AUR)                 |
| Windows  | NSIS `.exe` (x64)   | Download from Releases                  |

macOS releases are currently unsigned and not notarized because Apple requires a paid Developer ID account for notarization. If macOS says Ryco is damaged, use the `Install Ryco.command` helper included in the DMG or run:

```bash
xattr -dr com.apple.quarantine /Applications/Ryco.app
open /Applications/Ryco.app
```

## Project status

Ryco is **very early**. Expect bugs and breaking changes. We aren't accepting contributions yet.

If you want to follow along, join the [Discord](https://discord.gg/jn4EGJjrvv) or watch the repo.

## Development

If you really want to dive into the code:

```bash
# Optional: only needed if you use mise for dev tool management
mise install

bun install

# Run the desktop app in dev mode
bun run dev:desktop

# Run just the web app
bun run dev:web

# Required checks before finishing changes
bun fmt
bun lint
bun typecheck

# Vitest suite
bun run test
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

## Documentation

- [Architecture overview](./.docs/architecture.md)
- [Workspace layout](./.docs/workspace-layout.md)
- [Provider architecture](./.docs/provider-architecture.md)
- [Remote architecture](./.docs/remote-architecture.md)
- [Node identity primitives](./docs/node-identity.md)
- [Codex provider guide](./docs/providers/codex.md)
- [Claude provider guide](./docs/providers/claude.md)
- [Observability guide](./docs/observability.md)
- [Source-control providers](./docs/source-control-providers.md)
- [Release process](./docs/release.md)
- [Keybindings](./KEYBINDINGS.md)

## License

[MIT](./LICENSE) © Ryco Inc.

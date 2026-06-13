# ryco-cli

Ryco is a minimal web GUI for coding agents. The CLI starts the Ryco server, serves the bundled web app, and connects it to local provider runtimes such as Codex, Claude, GitHub Copilot, OpenCode, and Cursor.

Ryco is early WIP. Expect bugs and breaking changes.

## Install

Run without installing:

```bash
npx ryco-cli
```

Or install globally:

```bash
npm install -g ryco-cli
ryco
```

## Provider Setup

Install and authenticate at least one provider before using Ryco:

- Codex: install the Codex CLI and run `codex login`
- Claude: install Claude Code and run `claude auth login`
- OpenCode: install OpenCode and run `opencode auth login`
- GitHub Copilot and Cursor: install/authenticate the provider CLI expected by the corresponding SDK/runtime, then verify live status in Settings

Ryco discovers available providers from the machine running the CLI. Provider binaries, custom homes, server URLs, per-instance environment variables, display names, and accent colors are configured in Settings.

## Usage

Start Ryco for the current directory:

```bash
ryco
```

Start Ryco for another workspace:

```bash
ryco /path/to/project
```

Run without opening a browser:

```bash
ryco --no-browser
```

Run in headless mode and print pairing details for remote clients:

```bash
ryco serve --host 0.0.0.0 --port 3773
```

Common options:

- `--host <host>`: host/interface to bind, for example `127.0.0.1` or `0.0.0.0`
- `--port <port>`: HTTP/WebSocket server port
- `--base-dir <path>`: Ryco state directory, equivalent to `RYCO_HOME`
- `--mode web|desktop`: runtime mode
- `--no-browser`: disable automatic browser opening
- `--auto-bootstrap-project-from-cwd`: create a project for the current working directory on startup when missing
- `--tailscale-serve`: expose this backend over HTTPS on the Tailnet through Tailscale Serve
- `--log-websocket-events`: emit server-side WebSocket traffic logs for debugging

Useful commands:

```bash
ryco start [options] [cwd]
ryco serve [options] [cwd]

ryco project add <path> [--title <title>]
ryco project remove <project-id-or-path>
ryco project rename <project-id-or-path> <title>

ryco auth pairing create [--ttl 1h] [--base-url <url>]
ryco auth pairing list
ryco auth pairing revoke <id>

ryco auth session issue [--ttl 30d] [--role owner|client]
ryco auth session list
ryco auth session revoke <session-id>
```

Run `ryco --help` or `ryco <command> --help` for the full command reference.

## Links

- Repository: https://github.com/sak0a/ryco
- Releases: https://github.com/sak0a/ryco/releases
- Discord: https://discord.gg/jn4EGJjrvv

## License

MIT

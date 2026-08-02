# Expanded “Open in…” Apps Design

**Date:** 2026-08-02

## Summary

Expand Ryco’s detected “Open in…” catalog with Terminal, Android Studio, Xcode, Windsurf,
Sublime Text, Nova, and Positron. Each installed target appears with an appropriate icon in the
chat header picker. File-capable applications also appear in default-editor settings. Launching
remains server-owned so web, desktop, and remotely connected clients use the applications
installed beside the Ryco server.

Fleet is deliberately excluded. JetBrains stopped distributing and updating Fleet in December
2025, so adding a new first-party integration would create a dead-end catalog entry.

## Goals

- Add the seven approved applications without regressing existing editor behavior.
- Open a project or worktree in a newly supported application using its documented CLI or native
  platform launcher.
- Show only applications that can actually be launched on the server host.
- Give each application a recognizable icon in every editor-selection surface.
- Keep launch metadata, display metadata, and tests exhaustive when a new `EditorId` is added.
- Preserve file-and-position navigation for applications whose CLIs support it.

## Non-goals

- User-defined launcher commands.
- Separate entries for individual terminal emulators such as Warp, iTerm2, Ghostty, or WezTerm.
- Terminal-hosted editors such as Neovim, Vim, Helix, or Emacs.
- Installing applications or modifying the user’s `PATH`.
- Extending the frozen web phone presentation tier.
- Renaming the existing editor contracts and RPC methods to more general “application” names.

## Catalog

| ID               | Label                       | Platforms             | Primary launch path                                | Position support                |
| ---------------- | --------------------------- | --------------------- | -------------------------------------------------- | ------------------------------- |
| `terminal`       | Terminal / Windows Terminal | macOS, Windows, Linux | Platform terminal resolver                         | Workspace only                  |
| `android-studio` | Android Studio              | macOS, Windows, Linux | `studio`, `studio64.exe`, or app-bundle executable | JetBrains line/column arguments |
| `xcode`          | Xcode                       | macOS                 | `xed` or Xcode-bundled `xed`                       | Direct file/path handling       |
| `windsurf`       | Windsurf                    | macOS, Windows, Linux | `windsurf`                                         | VS Code-style `--goto`          |
| `sublime-text`   | Sublime Text                | macOS, Windows, Linux | `subl` or installed app executable                 | `path:line:column`              |
| `nova`           | Nova                        | macOS                 | `nova`                                             | Nova line/column arguments      |
| `positron`       | Positron                    | macOS, Windows, Linux | `positron`                                         | VS Code-style `--goto`          |

The existing `EDITORS` order remains the preference order. GUI editors are inserted alongside
similar existing applications. Terminal remains near File Manager at the end so installing a
terminal does not unexpectedly make it the automatic default editor.

## Architecture

### Shared contracts

`packages/contracts/src/editor.ts` remains the authoritative list of supported IDs, labels,
command candidates, and launch styles. Extend the definition just enough to distinguish ordinary
command editors from platform-owned workspace launchers. Avoid hard-coding Terminal into every
consumer.

The definition must continue to derive the `EditorId` schema so RPC validation, settings, and
server state automatically accept the new IDs.

### Server detection and launch resolution

`apps/server/src/open.ts` remains the sole owner of application discovery and launch argument
construction.

Ordinary applications follow the existing resolution order:

1. Find the first supported executable on `PATH`.
2. On macOS, check known executable paths inside `/Applications` and `~/Applications` app bundles.
3. If neither is present, omit the application from `availableEditors`.

The Terminal entry uses a dedicated platform resolver because terminal emulators use incompatible
working-directory flags:

- macOS launches Terminal.app through `open -a Terminal <directory>` after confirming the system
  application is available.
- Windows launches Windows Terminal with `wt.exe -d <directory>` when `wt.exe` is available.
- Linux selects the first detected, explicitly supported terminal and produces that terminal’s
  native working-directory arguments. Initial support covers GNOME Terminal, Konsole, XFCE
  Terminal, Kitty, WezTerm, Alacritty, and Ghostty. Ryco does not invoke the ambiguous
  `x-terminal-emulator` alternative with guessed flags.

Terminal accepts workspace directories only. It must not try to interpret `:line:column` suffixes
as directories. The display/preference layer classifies Terminal as a workspace-only opener, so
it appears in workspace Open menus but not in default-editor settings. Selecting Terminal does
not replace the preferred file-capable editor used by markdown links and diff line navigation.
File Manager retains its existing preference behavior.

All launch operations stay detached and argument-array based. No new shell string interpolation is
introduced.

### Web display metadata

Add local, component-native SVG icons for Android Studio, Xcode, Windsurf, Sublime Text, Nova, and
Positron. Terminal uses Lucide’s terminal glyph so it remains legible at the picker’s small icon
size and does not falsely imply one third-party terminal emulator.

Consolidate the duplicated editor label/icon tables currently split between
`OpenInPicker.tsx` and `SettingsPanels.editor.ts` into one web display-metadata module. That module
provides:

- an exhaustive `Record<EditorId, Icon>`;
- platform-aware labels for Terminal and File Manager;
- a capability check for file-capable editors versus the workspace-only Terminal opener; and
- ordered picker options derived from `EDITORS` and filtered by `availableEditors`.

Both the header picker and settings select consume this module. Adding a future `EditorId` then
causes a TypeScript error until its icon metadata is supplied.

## Data flow

1. The server resolves installed launch targets when it builds server configuration state.
2. The client receives the ordered `availableEditors` array through the existing contract.
3. The header picker intersects that list with exhaustive web display metadata.
4. Selecting an item sends the existing `shell.openInEditor({ cwd, editor })` RPC.
5. The server resolves a concrete executable and argument array for the host platform, then spawns
   it detached.
6. Existing editor and File Manager selections retain their current preference behavior. Terminal
   launches immediately but does not displace the file-capable preference.

No application paths or host filesystem details are sent to the browser.

## Failure behavior

- An application that cannot be detected is not advertised and cannot be selected through normal
  UI flows.
- A launch request for a known but no-longer-available application returns the existing `OpenError`
  rather than falling back to a different editor.
- Failed launches do not change the saved preferred editor.
- Terminal detection never guesses flags for an unknown Linux terminal.
- Existing stale or unknown editor IDs remain rejected by the Effect schema at the RPC boundary.

## Testing

### Unit tests

- Verify command and app-bundle discovery for every new GUI application.
- Verify launch arguments for directories and positioned file paths where supported.
- Verify Terminal discovery and working-directory arguments on macOS, Windows, and each supported
  Linux terminal family.
- Verify Terminal cannot become the preferred file editor.
- Verify the icon map covers every `EditorId` and platform-aware labels are correct.

### Browser tests

- Verify newly available applications appear in the Open picker with their labels and icons.
- Verify unavailable applications remain absent.
- Verify selecting Terminal opens the current project directory without changing the preferred
  file editor.
- Verify Android Studio and another non-JetBrains addition send the expected editor ID.

### Repository backstops

Run the required full repository checks:

```sh
bun install --frozen-lockfile
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
```

Because the picker and settings interaction change, also run:

```sh
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

Install the pinned browser runtime first when needed with
`bun run --cwd apps/web test:browser:install`.

## References

- [Xcode command-line tool reference](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference)
- [Sublime Text command-line interface](https://www.sublimetext.com/docs/command_line.html)
- [Nova command-line interface](https://help.nova.app/projects/cli/)
- [Positron terminal launcher](https://positron.posit.co/add-to-path.html)
- [JetBrains announcement ending Fleet distribution](https://blog.jetbrains.com/fleet/2025/12/the-future-of-fleet/)

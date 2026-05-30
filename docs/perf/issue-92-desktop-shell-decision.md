# Issue #92 Desktop Shell and Native Sidecar Decision

Date: 2026-05-30

Parent issue: #80

Phase: #92, after #86-#91

## Decision

Continue with targeted Electron, Node, and renderer optimization. Do not start a Tauri migration
or add Rust/Go sidecars from the current data.

Native sidecars remain a valid future option for narrow, measured process-bound workloads. A Tauri
shell remains a valid future packaging and baseline-footprint experiment. Neither is justified as
the next implementation step because the completed phases found and addressed hot paths inside the
existing web/server architecture, while full packaged idle and workload measurements are still
missing.

## Evidence Reviewed

### Phase outcomes

| Phase     | Outcome                                                                                                                                            | Decision impact                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| #86       | Added opt-in performance instrumentation for server/WebSocket/terminal rates and renderer hot-surface render timing.                               | Gives Ryco a repeatable measurement path, but the baseline doc still records CPU, GPU, memory, and live rates as gaps. |
| #87 / #94 | Made release sourcemaps opt-in, deferred Shiki work for streaming code blocks, and batched terminal output writes.                                 | Addresses artifact size and two renderer-runtime hot paths without changing shell technology.                          |
| #88 / #95 | Coalesced live assistant deltas server-side with interval, completion, error, drain, and threshold flush behavior; preserved final assistant text. | Reduces streaming event fanout at the current architecture boundary.                                                   |
| #89 / #96 | Consolidated active chat/timeline derivations and improved row/reference stability.                                                                | Reduces React/Zustand churn in the active chat path, which Tauri would not automatically fix.                          |
| #90 / #97 | Gated sidebar animation/source-control polling and shared git status work across visible rows.                                                     | Reduces large-workspace pressure without needing native git scanning yet.                                              |
| #91 / #98 | Reworked diff search around reusable indexes, debounced queries, viewport-aware highlighting, and tighter worker/preview paths.                    | Moves a known renderer hotspot away from repeated rendered-DOM scans.                                                  |

### Current measured and known values

The latest public release before the Phase 1-5 merges is `v0.1.2` from 2026-05-28. It gives a
packaged-size baseline, but not a post-optimization size result:

| Artifact                     | Bytes       | Approx size |
| ---------------------------- | ----------- | ----------- |
| `Ryco-0.1.2-arm64.dmg`       | 215,104,733 | 205.1 MiB   |
| `Ryco-0.1.2-x64.dmg`         | 219,769,941 | 209.6 MiB   |
| `Ryco-0.1.2-x64.exe`         | 178,899,973 | 170.6 MiB   |
| `Ryco-0.1.2-x86_64.AppImage` | 307,989,186 | 293.7 MiB   |

Release sourcemaps are now opt-in after #87/#94, so the next artifacts should be smaller, but that
delta has not been measured in a release artifact yet.

`docs/perf/issue-80-baseline.md` documents that no interactive desktop/web scenario was captured
during Phase 0. CPU, GPU, energy, memory, and live `[perf]` rates remain measurement gaps. That is
important: the project has evidence of architectural hot paths that were fixed, but it does not
yet have evidence that Electron itself is the dominant remaining cost.

## Option Comparison

| Criterion           | Continue Electron/Node optimization                                                                                                                                               | Narrow Rust/Go sidecars                                                                                                                                                            | Tauri shell migration                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packaged size       | Current public Electron artifacts are roughly 171-294 MiB depending on platform. Sourcemap gating should help the next release, but the post-change artifact delta is unmeasured. | Adds at least one native binary per platform/arch. Can reduce size only if it lets us remove larger Node dependencies or avoid bundling heavy tools; no current data shows that.   | Likely best chance to reduce shell size, especially on platforms with a system WebView, but a Ryco PoC would be required because the backend, terminal, update, and bundled web assets still ship.               |
| Cold start          | Existing startup timing hooks already exist in desktop/web code. No post-Phase 5 cold-start run is recorded. Continue measuring before changing shell.                            | Could improve startup only for work currently blocking Node/Electron startup. No such native-bound startup blocker is measured.                                                    | Could improve shell startup and process count, but not guaranteed for Ryco because the Node/Bun backend and provider processes still need to start. Migration also risks startup regressions during parity work. |
| Idle CPU/GPU/memory | Earlier fixes removed always-on visual/compositor work, restored background throttling, and reduced renderer churn. Remaining idle numbers are unmeasured.                        | Useful only if idle work is mostly subprocess polling, git scanning, or filesystem watching. Current Phase 4 changes already reduced sidebar polling pressure first.               | May reduce baseline shell memory/GPU cost, but it will not fix React subscriptions, CSS paint, Shiki, diff search, or event fanout. Current evidence points to those app-layer paths.                            |
| Active streaming    | #88/#95 coalesced assistant deltas. #89/#96 stabilized chat/timeline derivations. #87/#94 deferred streaming Shiki. These are direct fixes at the measured/suspected hot path.    | A sidecar is unlikely to help assistant streaming unless serialization, markdown, or highlighter work becomes a measured CPU wall. Current changes already target that path in JS. | Tauri would keep the same React streaming work unless the renderer code changes. It is not a streaming fix by itself.                                                                                            |
| Terminal workloads  | #87/#94 and #95 batch xterm writes while preserving ordering around control events. This directly targets terminal burst behavior.                                                | A sidecar may be justified later for PTY lifecycle supervision, process accounting, or platform-specific terminal integration if Node/node-pty is measured as the bottleneck.      | Tauri does not remove the need for PTY handling and may complicate terminal permission/process behavior across platforms.                                                                                        |
| Release complexity  | Current pipeline already handles DMG/ZIP, NSIS, AppImage, update manifests, unsigned macOS fallback, and Windows signing toggles. Complexity is known.                            | Adds cross-compilation, per-arch artifact management, sidecar version compatibility, crash handling, protocol compatibility, and update coupling.                                  | Replaces much of the desktop release stack and update path. Requires parity for deep links, updater/signing, local backend startup, preload equivalents, native menus, window behavior, and platform packaging.  |
| Cross-platform risk | Lowest. Existing Electron behavior and release scripts are already exercised across macOS, Windows, and Linux targets.                                                            | Medium. Narrow APIs can contain risk, but PTY, filesystem, git, and process semantics differ sharply across OSes.                                                                  | Highest. Tauri reduces some shell cost but changes WebView/runtime behavior, packaging, updater, IPC, and OS integration all at once.                                                                            |

## Recommendation

Stay on Electron/Node for now and make the next performance work measurement-driven:

1. Build a post-Phase 5 packaged artifact and record artifact sizes against `v0.1.2`.
2. Run the Phase 0 scenarios from `docs/perf/issue-80-baseline.md` on a packaged build with
   DevTools closed where possible.
3. Only create implementation issues for native sidecars or Tauri if those runs show a shell-level
   or Node-level bottleneck that remains after the existing app-layer fixes.

The best current path is not a migration; it is closing the measurement gap. The Phase 0-5 work
already reduced the most obvious web/server causes of resource use, and several of those issues
would have followed the app into Tauri unchanged.

## Revisit Triggers

Create a narrow native-sidecar issue if packaged measurements show one of these:

- git/source-control scans dominate CPU or event-loop delay after Phase 4 gating;
- PTY supervision or terminal output processing remains a top CPU source after client batching;
- a specific Node dependency or subprocess materially inflates artifact size and can be replaced
  behind a small stable API;
- long-running sessions show memory growth tied to server-side process tracking rather than web
  retention, caches, or renderer state.

Create a Tauri prototype issue if packaged measurements show one of these:

- idle Electron shell processes dominate memory/GPU/energy after renderer work is quiet;
- cold start remains dominated by Electron shell initialization rather than backend startup,
  provider startup, client hydration, or asset loading;
- release artifact size remains an explicit product blocker after sourcemap gating and dependency
  pruning;
- the team is prepared to fund a parity prototype for updater, signing, local backend lifecycle,
  terminal behavior, and cross-platform WebView differences.

## Follow-up Issues

No implementation follow-up issues were created from this phase. The available data justifies a
post-Phase 5 packaged measurement pass, not a Rust/Go sidecar or Tauri migration.

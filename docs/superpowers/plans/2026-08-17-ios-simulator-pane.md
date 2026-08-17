# iOS Simulator Workspace Pane Implementation Plan

Design: `docs/superpowers/specs/2026-08-17-ios-simulator-pane-design.md`

## Objective

Adapt Synara 0.7.2's MIT-licensed iOS Simulator implementation into Ryco's server-owned services,
shared client runtime, Effect RPC, provider-driver SPI, and route-backed workspace panel. Deliver live
video, direct control, recording, provider-neutral device tools for every built-in driver, remote and
hosted lifecycle safety, packaging, attribution, and proportional verification.

## Task 1: Upstream provenance and shared primitives

Files:

- `THIRD_PARTY_NOTICES.md`
- `packages/shared/src/deviceFrame.ts`
- `packages/shared/src/deviceFrame.test.ts`
- `packages/shared/src/deviceHelperCache.ts`
- `packages/shared/src/deviceHelperCache.test.ts`
- `packages/shared/package.json`

Steps:

1. Add the complete Synara v0.7.2 MIT notice and exact feature source reference.
2. Adapt the bounded binary frame envelope and malformed-input checks under `@ryco/shared/deviceFrame`.
3. Adapt helper source-digest/cache-key calculation under an explicit shared subpath export.
4. Rename product identifiers while preserving behavior, constants, and provenance.
5. Cover codec-config, keyframe, bounds, invalid frame, and digest invalidation cases.

Focused validation:

```sh
bun run --cwd packages/shared test src/deviceFrame.test.ts src/deviceHelperCache.test.ts
bun run --cwd packages/shared typecheck
```

## Task 2: Device contracts and RPC protocol

Files:

- `packages/contracts/src/device.ts`
- `packages/contracts/src/device.test.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/keybindings.ts`
- `packages/contracts/src/rpc.ts`
- relevant RPC/keybinding tests

Steps:

1. Add provider-neutral device IDs, descriptors, availability/setup states, thread state, attach phases,
   events, errors, operation inputs/results, frame metadata, recording results, UI-tree nodes, and open
   reasons.
2. Retain the approved bounds: three owned boots, swipe duration limits, scroll limits, payload caps,
   and hardware-button catalogue without rotate.
3. Add typed unary methods for capability/state/list/boot/attach/detach/shutdown/install/launch/URL,
   input, screenshot, recording, accessibility, and frame resync.
4. Add device-event and pane-open subscriptions and the `workspace.simulator` keybinding command.
5. Assign RPC access metadata so read operations are viewer-safe and mutation is owner-only.

Focused validation:

```sh
bun run --cwd packages/contracts test src/device.test.ts src/rpc.test.ts src/keybindings.test.ts
bun run --cwd packages/contracts typecheck
```

## Task 3: Native helper source and build boundary

Files:

- `apps/server/native/device-helper/HEADER.md`
- `apps/server/native/device-helper/build.sh`
- `apps/server/native/device-helper/device-helper.sb`
- `apps/server/native/device-helper/Sources/*`
- `apps/server/src/device/helperCapabilities.ts`
- `apps/server/src/device/helperClient.ts`
- `apps/server/src/device/helperSandbox.ts`
- corresponding focused tests

Steps:

1. Import and rebrand the attributed Swift/Objective-C helper source without changing private API
   symbol behavior.
2. Preserve VideoToolbox H.264, IOSurface capture, HID acknowledgement, accessibility lookup,
   screenshots, capability probing, framing bounds, and source-shipped compilation.
3. Adapt cache paths, environment names, diagnostics, and headers to Ryco.
4. Preserve the deny-by-default Seatbelt profile and explicit diagnostic opt-out.
5. Test capability parsing, request correlation, timeouts, malformed frames, sandbox paths, and
   confinement diagnostics with process mocks.

Focused validation:

```sh
bun run --cwd apps/server test src/device/helperCapabilities.test.ts src/device/helperClient.test.ts src/device/helperSandbox.test.ts
bun run --cwd apps/server typecheck
```

## Task 4: iOS backend and lifecycle service

Files:

- `apps/server/src/device/DeviceBackend.ts`
- `apps/server/src/device/FakeDeviceBackend.ts`
- `apps/server/src/device/IosSimulatorBackend.ts`
- `apps/server/src/device/bootOwnership.ts`
- `apps/server/src/device/deviceTypeCatalogue.ts`
- `apps/server/src/device/uiTreeTargeting.ts`
- `apps/server/src/device/DeviceManager.ts`
- `apps/server/src/device/Services/DeviceService.ts`
- `apps/server/src/device/Layers/DeviceService.ts`
- corresponding backend, manager, ownership, and targeting tests

Steps:

1. Define a generic backend interface and adapt the Synara iOS backend for Ryco paths/process
   abstractions.
2. Normalize simctl discovery, Xcode setup/capability states, boot, shutdown, install, launch, URL,
   recording, screenshot, helper stream, HID, and accessibility behavior.
3. Implement atomic PID/UDID ownership persistence with conservative orphan recovery.
4. Implement thread attachments, three-owned-device cap, immediate switch cleanup, ten-minute detach
   cleanup, 750 ms attach retry, 60-second deadline, attempt tokens, recording finalization, and
   deterministic disposal.
5. Keep manager policy backend-agnostic and fully test it with `FakeDeviceBackend`.
6. Provide a stable unsupported service on non-Mac platforms.

Focused validation:

```sh
bun run --cwd apps/server test src/device/DeviceManager.test.ts src/device/DeviceManager.coldBoot.test.ts src/device/IosSimulatorBackend.test.ts src/device/IosSimulatorBackend.capabilities.test.ts src/device/IosSimulatorBackend.reboot.test.ts src/device/bootOwnership.test.ts src/device/uiTreeTargeting.test.ts
bun run --cwd apps/server typecheck
```

## Task 5: Bounded frame transport and server RPC

Files:

- `apps/server/src/device/deviceFrameTransport.ts`
- `apps/server/src/device/deviceFrameRoute.ts`
- `apps/server/src/device/wsDeviceHandlers.ts`
- `apps/server/src/ws/deviceRpc.ts`
- `apps/server/src/ws/index.ts`
- `apps/server/src/ws.ts`
- server runtime/layer composition files
- corresponding transport, route, RPC authorization, and subscription tests

Steps:

1. Add bounded per-subscriber delivery with an eight-frame queue, 2 MiB socket budget,
   drop-until-keyframe recovery, and late-subscriber codec/keyframe priming.
2. Register typed Effect RPC handlers and device-event/open-request streams.
3. Add the direct authenticated binary route as a child of the existing connection authorization;
   it must not publish independent readiness.
4. Add hosted relay virtual-channel framing through the existing encrypted connection owner.
5. Enforce viewer reads, owner mutations, input bounds, generation fencing, and sanitized errors.
6. Wire thread removal and server finalization into `DeviceService` exactly once.

Focused validation:

```sh
bun run --cwd apps/server test src/device/deviceFrameTransport.test.ts src/device/deviceFrameRoute.test.ts src/device/wsDeviceHandlers.test.ts src/ws/RpcAccessPolicy.test.ts
bun run --cwd apps/server typecheck
```

## Task 6: Shared client-runtime device domain

Files:

- `packages/client-runtime/src/rpc/wsRpcClient.ts`
- `packages/client-runtime/src/rpc/wsTransport.ts`
- `packages/client-runtime/src/connection/*` where the supervised logical frame channel belongs
- `packages/client-runtime/src/state/device/index.ts`
- `packages/client-runtime/src/state/device/store.ts`
- `packages/client-runtime/src/state/device/*.test.ts`
- `packages/client-runtime/package.json`

Steps:

1. Add the typed device API to the shared RPC client.
2. Add environment/thread-keyed state that applies only monotonically newer device versions.
3. Seed state on first observation and every new open connection generation.
4. Implement a supervised frame source that selects direct binary or hosted encrypted virtual
   transport without owning connection readiness.
5. Reject old-generation state and frames; implement reconnect/resync with 500 ms exponential
   backoff capped at five seconds.
6. Export the device domain explicitly without DOM or React Native dependencies.

Focused validation:

```sh
bun run --cwd packages/client-runtime test src/state/device src/rpc/wsRpcClient.test.ts src/rpc/wsTransport.test.ts
bun run --cwd packages/client-runtime typecheck
```

## Task 7: Simulator panel logic and rendering

Files:

- `apps/web/src/components/DevicePanel.logic.ts`
- `apps/web/src/components/DevicePanel.logic.test.ts`
- `apps/web/src/components/DevicePanel.tsx`
- `apps/web/src/components/device/DeviceFrame.tsx`
- `apps/web/src/components/device/DeviceFrame.test.ts`
- `apps/web/src/components/device/DeviceControlRail.tsx`
- `apps/web/src/components/device/DeviceScreenStates.tsx`
- `apps/web/src/components/device/useDeviceVideoStream.ts`
- browser tests for the panel

Steps:

1. Adapt Synara's pure picker, setup, attach, frame-gate, pointer geometry, keyboard, recording, and
   status logic to Ryco contracts/client state.
2. Render checking, setup, no-selection, boot/attach, live, agent-active, recovering, and failed states.
3. Decode Annex-B H.264 with WebCodecs, derive the codec from SPS, prepend parameter sets to the next
   keyframe, close every `VideoFrame`, and request resync after decoder failure.
4. Implement click/tap, drag/swipe, keyboard forwarding, Home, lock, volume, screenshot, recording,
   detach, shutdown, boot-limit choice, and retry actions.
5. Subscribe to frames only while visible and preserve the last valid frame while reconnecting.

Focused validation:

```sh
bun run --cwd apps/web test src/components/DevicePanel.logic.test.ts src/components/device/DeviceFrame.test.ts
bun run --cwd apps/web test:browser -- src/components/DevicePanel.browser.tsx
bun run --cwd apps/web typecheck
```

## Task 8: Workspace routing, auto-open, and prompt context

Files:

- `apps/web/src/rightPanelRouteSearch.ts`
- `apps/web/src/workspaceRouteSearch.ts`
- `apps/web/src/threadWorkspaceTabs.ts`
- `apps/web/src/components/ChatRightPanel.tsx`
- `apps/web/src/components/ThreadWorkspacePanel.tsx`
- thread route views and workspace-panel hooks
- `apps/web/src/components/chat/devicePaneOpenRequest.ts`
- `apps/web/src/lib/devicePromptContext.ts`
- `apps/web/src/components/chat/useChatGlobalShortcuts.ts`
- keybinding/default/shortcut presentation files
- related route, tab, prompt, and browser tests

Steps:

1. Register `simulator` as a route-backed workspace mode and lazy panel using existing resize,
   maximize, tab-close, persistence, and animation behavior.
2. Hide it on non-capable nodes and every phone/native-mobile surface while retaining the setup tab
   on a capable Mac without Xcode/runtime/helper readiness.
3. Add manual opening and the configurable `workspace.simulator` command.
4. Apply same-thread open requests immediately and remember inactive-thread requests without
   navigating away.
5. Add the approved scope-plus-action prompt matcher and one bounded screenshot attachment that
   never blocks send.

Focused validation:

```sh
bun run --cwd apps/web test src/rightPanelRouteSearch.test.ts src/threadWorkspaceTabs.test.ts src/lib/devicePromptContext.test.ts
bun run --cwd apps/web test:browser -- src/components/ThreadWorkspacePanel.browser.tsx src/components/ChatView.browser.tsx
```

## Task 9: Provider-neutral device tool gateway

Files:

- `apps/server/src/providerTools/DeviceToolCatalogue.ts`
- `apps/server/src/providerTools/BuiltInToolGateway.ts`
- tool input/result/approval helpers and tests
- `apps/server/src/provider/Services/ProviderAdapter.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- Codex, Claude, Copilot, OpenCode, Cursor, and Grok adapter/session files
- `apps/server/src/provider/builtInDrivers.ts`
- provider binding matrix tests

Steps:

1. Adapt the complete `device_*` catalogue and error classification into one server-owned module.
2. Issue ephemeral bindings scoped to thread, runtime session, provider instance, runtime mode, and
   active turn; revoke them on replacement/stop and reject stale calls.
3. Bind Codex and Claude through their MCP/session APIs, Copilot and OpenCode through their native
   MCP configuration, and Cursor/Grok through ACP `mcpServers`.
4. Leave user/global MCP configuration untouched.
5. Mark list/screenshot/accessibility as read-only; require an approval-capable runtime for boot,
   install, launch, URL, tap, swipe, scroll, type, and hardware buttons; refuse before effects when
   approval is unavailable.
6. Publish agent-active state and same-thread pane-open requests around successful interaction.
7. Add an exhaustive `BUILT_IN_DRIVERS` capability test; no enabled built-in may silently fall back
   to pane-only behavior.

Focused validation:

```sh
bun run --cwd apps/server test src/providerTools src/provider/Layers/CodexAdapter.test.ts src/provider/Layers/ClaudeAdapter.test.ts src/provider/Layers/CopilotProvider.test.ts src/provider/Layers/OpenCodeAdapter.test.ts src/provider/Layers/CursorAdapter.test.ts src/provider/Layers/GrokAdapter.test.ts
bun run --cwd apps/server typecheck
```

## Task 10: Packaging and native qualification tooling

Files:

- `apps/desktop/src/main.ts` or the existing resource-path boundary
- `apps/desktop/scripts/*` where packaged server resources are assembled
- `scripts/build-desktop-artifact.ts`
- `scripts/lib/desktop-platform-build-config.ts`
- `scripts/device-helper-smoke.ts`
- `scripts/device-helper-sweep.ts`
- `scripts/package.json`
- root `package.json`
- packaging and smoke tests

Steps:

1. Include every helper source/build/profile input in development and packaged server layouts.
2. Assert packaged-resource completeness and digest coverage.
3. Adapt the real-Mac smoke CLI to compile, boot, capture/decode, tap/acknowledge, inspect AX, take a
   screenshot, and clean up only its owned simulator.
4. Add `test:device` and an optional supported-Xcode helper build matrix without making ordinary
   cross-platform CI depend on a simulator runtime.
5. Ensure all temporary/output paths are explicit, bounded, and cleaned conservatively.

Focused validation:

```sh
bun run --cwd scripts test
bun run build:desktop
bun run test:device # when a supported Xcode and iOS runtime are available
```

## Task 11: Integrated validation and delivery

1. Install with the pinned Bun version using `bun install --frozen-lockfile`.
2. Run focused checks after each task and fix failures at their owning boundary.
3. Run formatting and diff checks across only changed files during implementation.
4. Run the full required backstop once because the finished feature crosses contracts, server,
   provider, transport, web, desktop packaging, and hosted connection boundaries.
5. Install the pinned browser runtime only if absent, build web/desktop, and run the browser suite.
6. Run the native smoke on the local Mac when Xcode/runtime capability is available; otherwise record
   the exact skipped prerequisite and keep mocked helper/backend tests mandatory.
7. Verify the worktree contains no generated helper binary, simulator recording, screenshot,
   credential, private deployment identifier, or `.superpowers` companion artifact.

Backstop:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
bun run build
bun run build:desktop
bun run --cwd apps/web test:browser:install # only if absent
bun run --cwd apps/web test:browser
```

Never invoke `bun test`; all Vitest execution must use `bun run test` or the package-level test
scripts shown above.

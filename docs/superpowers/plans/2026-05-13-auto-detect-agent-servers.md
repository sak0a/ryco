# Auto-Detect Agent-Spawned Servers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect dev servers (Vite, Next, Nuxt, Astro, Remix, Wrangler, Vitest UI, Storybook, HTTP/SSE MCP, generic Express) spawned by agents or local PTYs, present them in a "Servers" tab inside the existing terminal drawer with live xterm.js log tailing, and show a count badge in the toolbar.

**Architecture:** A new `apps/server/src/detectedServers/` Effect module runs a 4-stage detection pipeline (argv hint → stdout regex → OS socket probe → HTTP liveness heartbeat), feeds an in-memory registry keyed by `(threadId, serverId)`, and publishes events on a new `detectedServers.event` WS push channel. Read-only taps in `CodexSessionRuntime`, `AcpSessionRuntime`, and `terminal/Layers/Manager.ts` feed the detector without changing existing behavior. Web side adds a Zustand slice, a toolbar badge, and a kind-tabset inside `ThreadTerminalDrawer` with per-server xterm.js mounts.

**Tech Stack:** TypeScript, Effect 4.0 (Services/Layers/Schema), Vitest, node-pty, xterm.js v6, Zustand, TanStack Router. New runtime dep: `pidtree`.

**Spec:** `docs/superpowers/specs/2026-05-13-auto-detect-agent-servers-design.md`

---

## File structure

```
apps/server/src/detectedServers/
  Services/DetectedServerRegistry.ts              new
  Layers/Registry.ts                              new
  Layers/ArgvHinter.ts                            new
  Layers/StdoutSniffer.ts                         new
  Layers/SocketProbe.ts                           new
  Layers/SocketProbe.Linux.ts                     new
  Layers/SocketProbe.Darwin.ts                    new
  Layers/SocketProbe.Windows.ts                   new
  Layers/LivenessHeartbeat.ts                     new
  Layers/DetectedServersIngress.ts                new
  __fixtures__/stdout/{vite,next,nuxt,astro,
    remix,wrangler,webpack,express}.txt           new
  __fixtures__/proc/{tcp,tcp6,fd-snapshot}.txt    new
  ArgvHinter.test.ts                              new
  StdoutSniffer.test.ts                           new
  Registry.test.ts                                new
  SocketProbe.Linux.test.ts                       new
  SocketProbe.Darwin.test.ts                      new
  SocketProbe.Windows.test.ts                     new

apps/server/src/serverLayers.ts                   modify (+ ingress)
apps/server/src/wsServer.ts                       modify (+ RPC handlers, push)
apps/server/src/provider/Layers/CodexSessionRuntime.ts  modify (+ tap)
apps/server/src/provider/acp/AcpSessionRuntime.ts modify (+ tap)
apps/server/src/terminal/Layers/Manager.ts        modify (+ tap)

apps/server/integration/
  detectedServersPty.integration.test.ts          new
  detectedServersCodex.integration.test.ts        new

packages/contracts/src/detectedServers.ts         new
packages/contracts/src/rpc.ts                     modify (+ 3 RPCs)
packages/contracts/src/ws.ts                      modify (+ 1 channel)
packages/contracts/src/index.ts                   modify (+ re-exports)

packages/shared/src/lineBuffer.ts                 new
packages/shared/src/lineBuffer.test.ts            new
packages/shared/package.json                      modify (+ subpath export)

apps/web/src/detectedServerStore.ts               new
apps/web/src/detectedServerStore.test.ts          new
apps/web/src/rpc/wsRpcClient.ts                   modify (+ subscribe)
apps/web/src/terminalStateStore.ts                modify (+ drawerKind field)
apps/web/src/components/BranchToolbar.tsx         modify (+ badge slot)
apps/web/src/components/BranchToolbar/DetectedServersBadge.tsx       new
apps/web/src/components/BranchToolbar/DetectedServersBadge.test.tsx  new
apps/web/src/components/ThreadTerminalDrawer.tsx  modify (+ kind tabset)
apps/web/src/components/detectedServers/DetectedServersPanel.tsx     new
apps/web/src/components/detectedServers/DetectedServerRow.tsx        new
apps/web/src/components/detectedServers/DetectedServerLogView.tsx    new

package.json                                      modify (+ pidtree dep)
```

---

## Phase 1 — Foundations

Establish the schema, shared utilities, and dependency before any logic.

### Task 1: Add `pidtree` runtime dependency

**Files:**

- Modify: `package.json`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Add `pidtree` to `apps/server/package.json` dependencies**

```bash
cd apps/server && bun add pidtree
```

Expected: `pidtree` appears in `apps/server/package.json` dependencies.

- [ ] **Step 2: Verify lockfile resolves**

Run: `bun install`
Expected: no errors; `bun.lock` updated.

- [ ] **Step 3: Commit**

```bash
git add apps/server/package.json bun.lock
git commit -m "Add pidtree dependency for process-tree socket probing"
```

---

### Task 2: Add `LineBuffer` shared utility

**Files:**

- Create: `packages/shared/src/lineBuffer.ts`
- Create: `packages/shared/src/lineBuffer.test.ts`
- Modify: `packages/shared/package.json` (add subpath export)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/lineBuffer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LineBuffer } from "./lineBuffer.ts";

describe("LineBuffer", () => {
  it("appends chunks and yields complete lines on flush", () => {
    const buf = new LineBuffer({ maxLines: 100 });
    buf.write("hello\nworld\n");
    expect(buf.snapshot()).toEqual(["hello", "world"]);
  });

  it("retains incomplete trailing fragment until flush", () => {
    const buf = new LineBuffer({ maxLines: 100 });
    buf.write("hello\nwor");
    buf.write("ld\n");
    expect(buf.snapshot()).toEqual(["hello", "world"]);
  });

  it("trims head when maxLines exceeded", () => {
    const buf = new LineBuffer({ maxLines: 2 });
    buf.write("a\nb\nc\nd\n");
    expect(buf.snapshot()).toEqual(["c", "d"]);
  });

  it("clear() empties the buffer", () => {
    const buf = new LineBuffer({ maxLines: 100 });
    buf.write("a\nb\n");
    buf.clear();
    expect(buf.snapshot()).toEqual([]);
  });

  it("snapshot() returns a defensive copy", () => {
    const buf = new LineBuffer({ maxLines: 100 });
    buf.write("a\n");
    const snap = buf.snapshot();
    snap.push("mutation");
    expect(buf.snapshot()).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter @ryco/shared -- lineBuffer`
Expected: FAIL, "Cannot find module './lineBuffer.ts'".

- [ ] **Step 3: Implement `LineBuffer`**

Create `packages/shared/src/lineBuffer.ts`:

```ts
export interface LineBufferOptions {
  readonly maxLines: number;
}

/**
 * Rolling line buffer. Appends arbitrary chunks, splits on \n, retains an
 * incomplete trailing fragment for the next write, and trims from the head
 * when maxLines is exceeded.
 */
export class LineBuffer {
  private lines: string[] = [];
  private fragment = "";
  private readonly maxLines: number;

  constructor(options: LineBufferOptions) {
    this.maxLines = options.maxLines;
  }

  write(chunk: string): void {
    if (chunk.length === 0) return;
    const combined = this.fragment + chunk;
    const parts = combined.split("\n");
    this.fragment = parts.pop() ?? "";
    if (parts.length === 0) return;
    this.lines.push(...parts);
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines);
    }
  }

  snapshot(): string[] {
    return this.lines.slice();
  }

  clear(): void {
    this.lines = [];
    this.fragment = "";
  }
}
```

- [ ] **Step 4: Add subpath export to `packages/shared/package.json`**

In the `exports` field, add:

```json
"./lineBuffer": {
  "types": "./src/lineBuffer.ts",
  "default": "./src/lineBuffer.ts"
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun run test --filter @ryco/shared -- lineBuffer`
Expected: all 5 tests PASS.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/lineBuffer.ts packages/shared/src/lineBuffer.test.ts packages/shared/package.json
git commit -m "Add LineBuffer shared utility for rolling line storage"
```

---

### Task 3: Define `detectedServers` contracts schema

**Files:**

- Create: `packages/contracts/src/detectedServers.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Create the schema file**

Create `packages/contracts/src/detectedServers.ts`:

```ts
import { Schema } from "effect";

export const ServerStatus = Schema.Literals([
  "predicted",
  "candidate",
  "confirmed",
  "live",
  "restarting",
  "exited",
  "crashed",
]);
export type ServerStatus = typeof ServerStatus.Type;

export const ServerSource = Schema.Literals(["codex", "acp", "pty"]);
export type ServerSource = typeof ServerSource.Type;

export const ServerFramework = Schema.Literals([
  "vite",
  "next",
  "nuxt",
  "remix",
  "astro",
  "wrangler",
  "webpack",
  "vitest-ui",
  "storybook",
  "mcp-http",
  "express",
  "unknown",
]);
export type ServerFramework = typeof ServerFramework.Type;

export const ExitReason = Schema.Literals(["stopped", "crashed", "lost-socket"]);
export type ExitReason = typeof ExitReason.Type;

export const DetectedServer = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  threadId: Schema.String.check(Schema.isNonEmpty()),
  source: ServerSource,
  framework: ServerFramework,
  status: ServerStatus,
  url: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  host: Schema.optional(Schema.String),
  pid: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  argv: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  startedAt: Schema.Date,
  liveAt: Schema.optional(Schema.Date),
  lastSeenAt: Schema.Date,
  exitedAt: Schema.optional(Schema.Date),
  exitReason: Schema.optional(ExitReason),
});
export type DetectedServer = typeof DetectedServer.Type;

const DetectedServerEventBase = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
  createdAt: Schema.String,
});

const RegisteredEvent = Schema.Struct({
  ...DetectedServerEventBase.fields,
  type: Schema.Literal("registered"),
  server: DetectedServer,
});

const UpdatedEvent = Schema.Struct({
  ...DetectedServerEventBase.fields,
  type: Schema.Literal("updated"),
  serverId: Schema.String.check(Schema.isNonEmpty()),
  patch: Schema.Struct({
    status: Schema.optional(ServerStatus),
    framework: Schema.optional(ServerFramework),
    url: Schema.optional(Schema.String),
    port: Schema.optional(Schema.Int),
    host: Schema.optional(Schema.String),
    pid: Schema.optional(Schema.Int),
    liveAt: Schema.optional(Schema.Date),
    lastSeenAt: Schema.optional(Schema.Date),
    exitedAt: Schema.optional(Schema.Date),
    exitReason: Schema.optional(ExitReason),
  }),
});

const LogEvent = Schema.Struct({
  ...DetectedServerEventBase.fields,
  type: Schema.Literal("log"),
  serverId: Schema.String.check(Schema.isNonEmpty()),
  data: Schema.String,
});

const RemovedEvent = Schema.Struct({
  ...DetectedServerEventBase.fields,
  type: Schema.Literal("removed"),
  serverId: Schema.String.check(Schema.isNonEmpty()),
});

export const DetectedServerEvent = Schema.Union([
  RegisteredEvent,
  UpdatedEvent,
  LogEvent,
  RemovedEvent,
]);
export type DetectedServerEvent = typeof DetectedServerEvent.Type;

export const DetectedServerStopInput = Schema.Struct({
  serverId: Schema.String.check(Schema.isNonEmpty()),
});
export type DetectedServerStopInput = typeof DetectedServerStopInput.Type;

export const DetectedServerStopResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("stopped") }),
  Schema.Struct({
    kind: Schema.Literal("not-stoppable"),
    hint: Schema.Literal("interrupt-turn"),
  }),
]);
export type DetectedServerStopResult = typeof DetectedServerStopResult.Type;

export const DetectedServerOpenInBrowserInput = Schema.Struct({
  serverId: Schema.String.check(Schema.isNonEmpty()),
});
export type DetectedServerOpenInBrowserInput = typeof DetectedServerOpenInBrowserInput.Type;

export const SubscribeDetectedServerEventsInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
});
export type SubscribeDetectedServerEventsInput = typeof SubscribeDetectedServerEventsInput.Type;
```

- [ ] **Step 2: Re-export from package index**

Modify `packages/contracts/src/index.ts` — add:

```ts
export * from "./detectedServers.ts";
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/detectedServers.ts packages/contracts/src/index.ts
git commit -m "Add DetectedServer contracts schema"
```

---

### Task 4: Add `detectedServers.event` push channel + RPCs

**Files:**

- Modify: `packages/contracts/src/ws.ts`
- Modify: `packages/contracts/src/rpc.ts`

- [ ] **Step 1: Inspect the existing push channel definition**

Run: `grep -n "terminal.event\|server.welcome\|orchestration.domainEvent" packages/contracts/src/ws.ts`
Expected: matches showing the channel union and per-channel envelope shapes.

- [ ] **Step 2: Add `detectedServers.event` channel**

In `packages/contracts/src/ws.ts`, locate the discriminated union of push channels (search for `terminal.event`). Add an entry mirroring the terminal channel:

```ts
const DetectedServersEventEnvelope = Schema.Struct({
  channel: Schema.Literal("detectedServers.event"),
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  data: DetectedServerEvent,
});
```

…and add `DetectedServersEventEnvelope` to the push-channel union.

Import `DetectedServerEvent` from `./detectedServers.ts` at the top of `ws.ts`.

- [ ] **Step 3: Add RPC method definitions**

In `packages/contracts/src/rpc.ts`, locate the existing RPC registry (search for `subscribeTerminalEvents`). Add three entries:

```ts
subscribeDetectedServerEvents: {
  input: SubscribeDetectedServerEventsInput,
  output: DetectedServerEvent,
  stream: true,
},
"detectedServers.stop": {
  input: DetectedServerStopInput,
  output: DetectedServerStopResult,
  stream: false,
},
"detectedServers.openInBrowser": {
  input: DetectedServerOpenInBrowserInput,
  output: Schema.Struct({ ok: Schema.Boolean }),
  stream: false,
},
```

Adapt the exact registry shape to match the existing pattern in `rpc.ts`.

Import the four input/output schemas from `./detectedServers.ts`.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ws.ts packages/contracts/src/rpc.ts
git commit -m "Wire detectedServers WS channel and RPC methods into contracts"
```

---

## Phase 2 — Detection services (pure, no I/O)

Each service is a self-contained Effect Service with TDD.

### Task 5: Implement `ArgvHinter`

**Files:**

- Create: `apps/server/src/detectedServers/Layers/ArgvHinter.ts`
- Create: `apps/server/src/detectedServers/ArgvHinter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/detectedServers/ArgvHinter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hintFromArgv } from "./Layers/ArgvHinter.ts";

describe("ArgvHinter.hintFromArgv", () => {
  const cases: ReadonlyArray<{
    name: string;
    argv: string[];
    expected: { framework: string; isLikelyServer: boolean };
  }> = [
    { name: "vite", argv: ["vite"], expected: { framework: "vite", isLikelyServer: true } },
    {
      name: "next dev",
      argv: ["next", "dev"],
      expected: { framework: "next", isLikelyServer: true },
    },
    {
      name: "nuxt dev",
      argv: ["nuxt", "dev"],
      expected: { framework: "nuxt", isLikelyServer: true },
    },
    {
      name: "astro dev",
      argv: ["astro", "dev"],
      expected: { framework: "astro", isLikelyServer: true },
    },
    {
      name: "remix dev",
      argv: ["remix", "dev"],
      expected: { framework: "remix", isLikelyServer: true },
    },
    {
      name: "wrangler dev",
      argv: ["wrangler", "dev"],
      expected: { framework: "wrangler", isLikelyServer: true },
    },
    {
      name: "vitest --ui",
      argv: ["vitest", "--ui"],
      expected: { framework: "vitest-ui", isLikelyServer: true },
    },
    {
      name: "storybook dev",
      argv: ["storybook", "dev"],
      expected: { framework: "storybook", isLikelyServer: true },
    },
    {
      name: "vite build",
      argv: ["vite", "build"],
      expected: { framework: "vite", isLikelyServer: false },
    },
    {
      name: "vitest run",
      argv: ["vitest", "run"],
      expected: { framework: "unknown", isLikelyServer: false },
    },
    { name: "tsc", argv: ["tsc"], expected: { framework: "unknown", isLikelyServer: false } },
    { name: "eslint", argv: ["eslint"], expected: { framework: "unknown", isLikelyServer: false } },
    {
      name: "unknown serve",
      argv: ["foo", "serve"],
      expected: { framework: "unknown", isLikelyServer: true },
    },
  ];

  for (const c of cases) {
    it(`hints ${c.name}`, () => {
      const got = hintFromArgv(c.argv, undefined);
      expect(got).toEqual(c.expected);
    });
  }

  it("re-scans package.json scripts.dev for indirect invocations", () => {
    const got = hintFromArgv(["npm", "run", "dev"], { scripts: { dev: "vite" } });
    expect(got).toEqual({ framework: "vite", isLikelyServer: true });
  });

  it("treats npm run build as build, not server", () => {
    const got = hintFromArgv(["npm", "run", "build"], { scripts: { build: "vite build" } });
    expect(got).toEqual({ framework: "vite", isLikelyServer: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter @ryco/server -- ArgvHinter`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `ArgvHinter`**

Create `apps/server/src/detectedServers/Layers/ArgvHinter.ts`:

```ts
import type { ServerFramework } from "@ryco/contracts";

export interface ArgvHint {
  framework: ServerFramework;
  isLikelyServer: boolean;
}

export interface PackageJsonShape {
  scripts?: Record<string, string>;
}

const DENY_TOKENS = new Set([
  "build",
  "test",
  "tsc",
  "eslint",
  "prettier",
  "playwright",
  "typecheck",
  "lint",
  "fmt",
]);

const SERVER_TRIGGER_TOKENS = new Set(["dev", "serve", "start", "watch"]);

const FRAMEWORK_TOKEN_MAP: ReadonlyArray<readonly [string, ServerFramework]> = [
  ["vite", "vite"],
  ["next", "next"],
  ["nuxt", "nuxt"],
  ["nuxi", "nuxt"],
  ["astro", "astro"],
  ["remix", "remix"],
  ["wrangler", "wrangler"],
  ["storybook", "storybook"],
  ["webpack-dev-server", "webpack"],
];

const PACKAGE_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);

export const hintFromArgv = (
  argv: ReadonlyArray<string>,
  pkg: PackageJsonShape | undefined,
): ArgvHint => {
  const tokens = argv.map((t) => t.toLowerCase());

  // Indirect invocation: <runner> run <script-name>
  if (
    tokens.length >= 3 &&
    PACKAGE_RUNNERS.has(tokens[0]!) &&
    tokens[1] === "run" &&
    pkg?.scripts?.[tokens[2]!]
  ) {
    const inner = pkg.scripts[tokens[2]!]!.split(/\s+/).filter(Boolean);
    return hintFromArgv(inner, undefined);
  }

  // Shortcut: <runner> dev / serve / start / watch (no explicit "run" keyword)
  if (
    tokens.length >= 2 &&
    PACKAGE_RUNNERS.has(tokens[0]!) &&
    SERVER_TRIGGER_TOKENS.has(tokens[1]!)
  ) {
    if (pkg?.scripts?.[tokens[1]!]) {
      const inner = pkg.scripts[tokens[1]!]!.split(/\s+/).filter(Boolean);
      return hintFromArgv(inner, undefined);
    }
  }

  // Special-case: vitest --ui (UI mode is a server; vitest run is not)
  if (tokens[0] === "vitest" && tokens.includes("--ui")) {
    return { framework: "vitest-ui", isLikelyServer: true };
  }

  // Framework token match
  for (const [tok, fw] of FRAMEWORK_TOKEN_MAP) {
    if (tokens[0]?.endsWith(tok) || tokens.includes(tok)) {
      const hasDeny = tokens.some((t) => DENY_TOKENS.has(t));
      if (hasDeny) return { framework: fw, isLikelyServer: false };
      return { framework: fw, isLikelyServer: true };
    }
  }

  // Generic server trigger tokens
  const hasServerTrigger = tokens.some((t) => SERVER_TRIGGER_TOKENS.has(t));
  const hasDeny = tokens.some((t) => DENY_TOKENS.has(t));
  if (hasServerTrigger && !hasDeny) {
    return { framework: "unknown", isLikelyServer: true };
  }

  return { framework: "unknown", isLikelyServer: false };
};
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test --filter @ryco/server -- ArgvHinter`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/detectedServers/Layers/ArgvHinter.ts apps/server/src/detectedServers/ArgvHinter.test.ts
git commit -m "Add ArgvHinter for framework detection from spawn argv"
```

---

### Task 6: Implement `StdoutSniffer` (regex + ANSI strip)

**Files:**

- Create: `apps/server/src/detectedServers/Layers/StdoutSniffer.ts`
- Create: `apps/server/src/detectedServers/StdoutSniffer.test.ts`
- Create: `apps/server/src/detectedServers/__fixtures__/stdout/vite.txt`
- Create: `apps/server/src/detectedServers/__fixtures__/stdout/next.txt`
- Create: `apps/server/src/detectedServers/__fixtures__/stdout/nuxt.txt`
- Create: `apps/server/src/detectedServers/__fixtures__/stdout/astro.txt`
- Create: `apps/server/src/detectedServers/__fixtures__/stdout/remix.txt`
- Create: `apps/server/src/detectedServers/__fixtures__/stdout/wrangler.txt`
- Create: `apps/server/src/detectedServers/__fixtures__/stdout/webpack.txt`
- Create: `apps/server/src/detectedServers/__fixtures__/stdout/express.txt`

- [ ] **Step 1: Create the eight fixture files**

Each fixture is real captured stdout from running the framework. Use simplified, ANSI-rich captures. Examples:

`__fixtures__/stdout/vite.txt`:

```
  VITE v5.0.10  ready in 312 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

`__fixtures__/stdout/next.txt`:

```
   ▲ Next.js 14.0.4
   - Local:        http://localhost:3000
   - Environments: .env

 ✓ Ready in 1.2s
```

`__fixtures__/stdout/nuxt.txt`:

```
ℹ Vite client warmed up in 432ms
ℹ Vite server warmed up in 451ms

  Nuxt 3.10.0 with Nitro 2.8.1


  ➜ Local:    http://localhost:3000/
  ➜ Network:  use --host to expose
```

`__fixtures__/stdout/astro.txt`:

```
 astro  v4.0.7 ready in 145 ms

┃ Local    http://localhost:4321/
┃ Network  use --host to expose
```

`__fixtures__/stdout/remix.txt`:

```
 💿 remix dev

 info  serving HTTP on http://localhost:3000
```

`__fixtures__/stdout/wrangler.txt`:

```
⛅️ wrangler 3.20.0

[mf:inf] Ready on http://127.0.0.1:8787
```

`__fixtures__/stdout/webpack.txt`:

```
<i> [webpack-dev-server] Project is running at:
<i> [webpack-dev-server] Loopback: http://localhost:8080/
<i> [webpack-dev-server] On Your Network (IPv4): http://192.168.1.42:8080/
```

`__fixtures__/stdout/express.txt`:

```
Server listening on port 3000
```

Embed ANSI sequences (`\x1b[36m`, `\x1b[0m`) liberally in the .txt files — these tests assert robustness against them.

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/detectedServers/StdoutSniffer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StdoutSniffer } from "./Layers/StdoutSniffer.ts";

const fixturePath = (name: string) =>
  join(import.meta.dirname, "__fixtures__/stdout", `${name}.txt`);

describe("StdoutSniffer", () => {
  it("extracts Vite URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("vite"), "utf8"));
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("http://localhost:5173/");
    expect(out[0]!.port).toBe(5173);
    expect(out[0]!.framework).toBe("vite");
  });

  it("extracts Next URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("next"), "utf8"));
    expect(out[0]!.url).toBe("http://localhost:3000");
    expect(out[0]!.framework).toBe("next");
  });

  it("extracts Nuxt URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("nuxt"), "utf8"));
    expect(out[0]!.url).toBe("http://localhost:3000/");
    expect(out[0]!.framework).toBe("nuxt");
  });

  it("extracts Astro URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("astro"), "utf8"));
    expect(out[0]!.url).toBe("http://localhost:4321/");
    expect(out[0]!.framework).toBe("astro");
  });

  it("extracts Remix URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("remix"), "utf8"));
    expect(out[0]!.url).toBe("http://localhost:3000");
    expect(out[0]!.framework).toBe("remix");
  });

  it("extracts Wrangler URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("wrangler"), "utf8"));
    expect(out[0]!.url).toBe("http://127.0.0.1:8787");
    expect(out[0]!.framework).toBe("wrangler");
  });

  it("extracts Webpack-DevServer URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("webpack"), "utf8"));
    expect(out[0]!.url).toBe("http://localhost:8080/");
    expect(out[0]!.framework).toBe("webpack");
  });

  it("extracts generic Express port", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("express"), "utf8"));
    expect(out[0]!.port).toBe(3000);
    expect(out[0]!.framework).toBe("express");
  });

  it("assembles URLs split across chunks", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed("Local: http://localho");
    sniffer.feed("st:5173/\n");
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("http://localhost:5173/");
  });

  it("strips ANSI before matching", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed("\x1b[36m  ➜  Local:\x1b[0m \x1b[1mhttp://localhost:5173/\x1b[0m\n");
    expect(out[0]!.url).toBe("http://localhost:5173/");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test --filter @ryco/server -- StdoutSniffer`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `StdoutSniffer`**

Create `apps/server/src/detectedServers/Layers/StdoutSniffer.ts`:

```ts
import type { ServerFramework } from "@ryco/contracts";

export interface UrlCandidate {
  url: string;
  port: number;
  host: string;
  framework: ServerFramework;
}

const ANSI_REGEX = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const URL_REGEX_GENERIC =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d+))?(?:\/\S*)?/i;

interface FrameworkPattern {
  framework: ServerFramework;
  lineHint: RegExp;
}

// Ordered specific → generic. First match wins per line.
const FRAMEWORK_PATTERNS: ReadonlyArray<FrameworkPattern> = [
  { framework: "vite", lineHint: /\bVITE\b|➜\s+Local:\s+http/i },
  { framework: "next", lineHint: /Next\.js|^\s*-?\s*Local:\s+http.*localhost:3000/i },
  { framework: "nuxt", lineHint: /Nuxt\s+\d|➜\s+Local:\s+http/i },
  { framework: "astro", lineHint: /astro\s+v\d|Local\s+http/i },
  { framework: "remix", lineHint: /remix dev|serving HTTP on/i },
  { framework: "wrangler", lineHint: /wrangler|\[mf:inf\] Ready on/i },
  { framework: "webpack", lineHint: /\[webpack-dev-server\] (?:Loopback|Project is running)/i },
];

const PORT_ONLY_REGEX = /\b(?:listening|server (?:listening|running))\b[^\d]*?\b(\d{2,5})\b/i;

export class StdoutSniffer {
  private fragment = "";
  private listeners = new Set<(c: UrlCandidate) => void>();
  private contextLines: { framework: ServerFramework | null; lines: string[] } = {
    framework: null,
    lines: [],
  };

  onCandidate(cb: (c: UrlCandidate) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  feed(chunk: string): void {
    if (chunk.length === 0) return;
    const combined = this.fragment + chunk;
    const parts = combined.split("\n");
    this.fragment = parts.pop() ?? "";
    for (const raw of parts) this.consumeLine(raw);
  }

  private consumeLine(raw: string): void {
    const line = raw.replace(ANSI_REGEX, "").replace(/\s+/g, " ").trim();
    if (!line) return;

    // Detect framework hint from any recent line; carry it forward
    for (const pattern of FRAMEWORK_PATTERNS) {
      if (pattern.lineHint.test(line)) {
        this.contextLines.framework = pattern.framework;
        break;
      }
    }

    // Try to extract URL on this line
    const urlMatch = line.match(URL_REGEX_GENERIC);
    if (urlMatch) {
      const url = urlMatch[0];
      const host = this.extractHost(url);
      const port = this.extractPort(url);
      if (port !== null) {
        this.emit({
          url,
          port,
          host,
          framework: this.contextLines.framework ?? "unknown",
        });
        return;
      }
    }

    // Fallback: port-only Express-style line
    const portMatch = line.match(PORT_ONLY_REGEX);
    if (portMatch) {
      const port = Number.parseInt(portMatch[1]!, 10);
      this.emit({
        url: `http://localhost:${port}`,
        port,
        host: "localhost",
        framework: this.contextLines.framework ?? "express",
      });
    }
  }

  private extractHost(url: string): string {
    const m = url.match(/https?:\/\/(\[[^\]]+\]|[^/:]+)/i);
    return m?.[1] ?? "localhost";
  }

  private extractPort(url: string): number | null {
    const m = url.match(/:(\d+)(?:\/|$)/);
    if (m) return Number.parseInt(m[1]!, 10);
    if (url.startsWith("https://")) return 443;
    if (url.startsWith("http://")) return 80;
    return null;
  }

  private emit(c: UrlCandidate): void {
    for (const l of this.listeners) l(c);
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun run test --filter @ryco/server -- StdoutSniffer`
Expected: all 10 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/detectedServers/Layers/StdoutSniffer.ts apps/server/src/detectedServers/StdoutSniffer.test.ts apps/server/src/detectedServers/__fixtures__/stdout/
git commit -m "Add StdoutSniffer for framework URL extraction from spawn output"
```

---

### Task 7: Implement `Registry` state machine

**Files:**

- Create: `apps/server/src/detectedServers/Layers/Registry.ts`
- Create: `apps/server/src/detectedServers/Registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/detectedServers/Registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Registry } from "./Layers/Registry.ts";
import type { DetectedServerEvent } from "@ryco/contracts";

const collectEvents = (registry: Registry) => {
  const events: DetectedServerEvent[] = [];
  registry.subscribe("thread-1", (e) => events.push(e));
  return events;
};

describe("Registry", () => {
  it("registers a predicted server and emits a registered event", () => {
    const r = new Registry();
    const events = collectEvents(r);
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: {
        framework: "vite",
        status: "predicted",
        pid: 42,
        port: 5173,
        argv: ["vite"],
        cwd: "/work",
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("registered");
    if (events[0]!.type === "registered") {
      expect(events[0]!.server.status).toBe("predicted");
      expect(events[0]!.server.framework).toBe("vite");
    }
  });

  it("emits updated on subsequent transitions", () => {
    const r = new Registry();
    const events = collectEvents(r);
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { framework: "vite", status: "predicted", pid: 42, port: 5173 },
    });
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { status: "candidate", url: "http://localhost:5173/" },
    });
    expect(events[1]!.type).toBe("updated");
  });

  it("rejects illegal transition (live → predicted)", () => {
    const r = new Registry();
    collectEvents(r);
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { framework: "vite", status: "live", pid: 42, port: 5173 },
    });
    expect(() =>
      r.registerOrUpdate({
        threadId: "thread-1",
        source: "pty",
        identityKey: "thread-1::42::5173",
        patch: { status: "predicted" },
      }),
    ).toThrow(/illegal transition/i);
  });

  it("treats same identityKey as restart, not new server", () => {
    const r = new Registry();
    const events = collectEvents(r);
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { framework: "vite", status: "live", pid: 42, port: 5173 },
    });
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { status: "restarting" },
    });
    expect(r.getCurrent("thread-1").length).toBe(1);
    expect(events.filter((e) => e.type === "registered").length).toBe(1);
  });

  it("getCurrent returns servers for a thread only", () => {
    const r = new Registry();
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { framework: "vite", status: "predicted", pid: 42, port: 5173 },
    });
    r.registerOrUpdate({
      threadId: "thread-2",
      source: "pty",
      identityKey: "thread-2::99::3000",
      patch: { framework: "next", status: "predicted", pid: 99, port: 3000 },
    });
    expect(r.getCurrent("thread-1").length).toBe(1);
    expect(r.getCurrent("thread-2").length).toBe(1);
  });

  it("publishLog emits log events to subscribers of the matching thread", () => {
    const r = new Registry();
    const events = collectEvents(r);
    r.registerOrUpdate({
      threadId: "thread-1",
      source: "pty",
      identityKey: "thread-1::42::5173",
      patch: { framework: "vite", status: "predicted", pid: 42, port: 5173 },
    });
    const serverId = r.getCurrent("thread-1")[0]!.id;
    r.publishLog(serverId, "hello\n");
    const log = events.find((e) => e.type === "log");
    expect(log).toBeDefined();
    if (log?.type === "log") {
      expect(log.data).toBe("hello\n");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter @ryco/server -- Registry`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `Registry`**

Create `apps/server/src/detectedServers/Layers/Registry.ts`:

```ts
import { randomUUID } from "node:crypto";
import type {
  DetectedServer,
  DetectedServerEvent,
  ServerFramework,
  ServerSource,
  ServerStatus,
  ExitReason,
} from "@ryco/contracts";

const ALLOWED_TRANSITIONS: Record<ServerStatus, ReadonlyArray<ServerStatus>> = {
  predicted: ["candidate", "confirmed", "exited", "crashed"],
  candidate: ["confirmed", "live", "exited", "crashed"],
  confirmed: ["live", "exited", "crashed"],
  live: ["restarting", "exited", "crashed"],
  restarting: ["live", "exited", "crashed"],
  exited: [],
  crashed: [],
};

export interface RegistryPatch {
  framework?: ServerFramework;
  status?: ServerStatus;
  url?: string;
  port?: number;
  host?: string;
  pid?: number;
  argv?: ReadonlyArray<string>;
  cwd?: string;
  liveAt?: Date;
  lastSeenAt?: Date;
  exitedAt?: Date;
  exitReason?: ExitReason;
}

export interface RegistryRegisterInput {
  threadId: string;
  source: ServerSource;
  identityKey: string;
  patch: RegistryPatch;
}

type Listener = (e: DetectedServerEvent) => void;

export class Registry {
  private byThread = new Map<string, Map<string, DetectedServer>>();
  private idByIdentity = new Map<string, string>();
  private listeners = new Map<string, Set<Listener>>();

  subscribe(threadId: string, listener: Listener): () => void {
    const set = this.listeners.get(threadId) ?? new Set();
    set.add(listener);
    this.listeners.set(threadId, set);
    return () => {
      const cur = this.listeners.get(threadId);
      cur?.delete(listener);
    };
  }

  getCurrent(threadId: string): DetectedServer[] {
    const m = this.byThread.get(threadId);
    return m ? [...m.values()] : [];
  }

  findById(serverId: string): DetectedServer | undefined {
    for (const m of this.byThread.values()) {
      const s = m.get(serverId);
      if (s) return s;
    }
    return undefined;
  }

  registerOrUpdate(input: RegistryRegisterInput): DetectedServer {
    const existingId = this.idByIdentity.get(input.identityKey);
    if (existingId) return this.updateExisting(input, existingId);
    return this.registerNew(input);
  }

  publishLog(serverId: string, data: string): void {
    const threadId = this.findThreadOf(serverId);
    if (!threadId) return;
    this.publish(threadId, {
      type: "log",
      threadId,
      serverId,
      data,
      createdAt: new Date().toISOString(),
    });
  }

  remove(serverId: string): void {
    const threadId = this.findThreadOf(serverId);
    if (!threadId) return;
    const m = this.byThread.get(threadId);
    const server = m?.get(serverId);
    if (!server || !m) return;
    m.delete(serverId);
    this.idByIdentity.forEach((id, key) => {
      if (id === serverId) this.idByIdentity.delete(key);
    });
    this.publish(threadId, {
      type: "removed",
      threadId,
      serverId,
      createdAt: new Date().toISOString(),
    });
  }

  private registerNew(input: RegistryRegisterInput): DetectedServer {
    const id = randomUUID();
    const now = new Date();
    const status = input.patch.status ?? "predicted";
    const server: DetectedServer = {
      id,
      threadId: input.threadId,
      source: input.source,
      framework: input.patch.framework ?? "unknown",
      status,
      url: input.patch.url,
      port: input.patch.port,
      host: input.patch.host,
      pid: input.patch.pid,
      argv: input.patch.argv,
      cwd: input.patch.cwd,
      startedAt: now,
      liveAt: input.patch.liveAt,
      lastSeenAt: now,
      exitedAt: input.patch.exitedAt,
      exitReason: input.patch.exitReason,
    };
    const m = this.byThread.get(input.threadId) ?? new Map();
    m.set(id, server);
    this.byThread.set(input.threadId, m);
    this.idByIdentity.set(input.identityKey, id);
    this.publish(input.threadId, {
      type: "registered",
      threadId: input.threadId,
      server,
      createdAt: now.toISOString(),
    });
    return server;
  }

  private updateExisting(input: RegistryRegisterInput, serverId: string): DetectedServer {
    const m = this.byThread.get(input.threadId);
    const cur = m?.get(serverId);
    if (!cur || !m) throw new Error(`Registry inconsistency: missing server ${serverId}`);

    if (input.patch.status && input.patch.status !== cur.status) {
      const legal = ALLOWED_TRANSITIONS[cur.status];
      if (!legal.includes(input.patch.status)) {
        throw new Error(`illegal transition ${cur.status} → ${input.patch.status} for ${serverId}`);
      }
    }

    const next: DetectedServer = {
      ...cur,
      ...input.patch,
      lastSeenAt: input.patch.lastSeenAt ?? new Date(),
    };
    m.set(serverId, next);
    this.publish(input.threadId, {
      type: "updated",
      threadId: input.threadId,
      serverId,
      patch: input.patch,
      createdAt: new Date().toISOString(),
    });
    return next;
  }

  private findThreadOf(serverId: string): string | undefined {
    for (const [threadId, m] of this.byThread) {
      if (m.has(serverId)) return threadId;
    }
    return undefined;
  }

  private publish(threadId: string, event: DetectedServerEvent): void {
    const set = this.listeners.get(threadId);
    if (!set) return;
    for (const l of set) l(event);
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test --filter @ryco/server -- Registry`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/detectedServers/Layers/Registry.ts apps/server/src/detectedServers/Registry.test.ts
git commit -m "Add Registry with state-machine validation and event publishing"
```

---

## Phase 3 — OS socket probing

Each OS adapter is independently testable via mocked I/O.

### Task 8: Define `SocketProbe` service contract

**Files:**

- Create: `apps/server/src/detectedServers/Layers/SocketProbe.ts`

- [ ] **Step 1: Create the facade interface**

Create `apps/server/src/detectedServers/Layers/SocketProbe.ts`:

```ts
import { Effect, Context } from "effect";

export interface ProbeResult {
  pid: number;
  port: number;
  host: string;
}

export interface SocketProbeShape {
  /**
   * Probe for LISTEN sockets owned by any of the given pids.
   * Returns rows of (pid, port, host) — empty when unavailable.
   */
  readonly probe: (pids: ReadonlyArray<number>) => Effect.Effect<ReadonlyArray<ProbeResult>>;
}

export class SocketProbe extends Context.Service<SocketProbe, SocketProbeShape>()(
  "s3/detectedServers/Layers/SocketProbe",
) {}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/detectedServers/Layers/SocketProbe.ts
git commit -m "Add SocketProbe service tag"
```

---

### Task 9: Implement `SocketProbe.Linux`

**Files:**

- Create: `apps/server/src/detectedServers/Layers/SocketProbe.Linux.ts`
- Create: `apps/server/src/detectedServers/SocketProbe.Linux.test.ts`
- Create: `apps/server/src/detectedServers/__fixtures__/proc/tcp.txt`
- Create: `apps/server/src/detectedServers/__fixtures__/proc/tcp6.txt`

- [ ] **Step 1: Create fixtures**

`__fixtures__/proc/tcp.txt`:

```
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1451 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345 1 0000000000000000 100 0 0 10 0
   1: 00000000:14B5 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 67890 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1452 0100007F:9999 01 00000000:00000000 00:00000000 00000000  1000        0 11111 1 0000000000000000 100 0 0 10 0
```

(`0A` = LISTEN state. Port `1451` = 5201 decimal, `14B5` = 5301, `1452` = 5202.)

`__fixtures__/proc/tcp6.txt`:

```
  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 22222 1 0000000000000000 100 0 0 10 0
```

(`1F90` = 8080 decimal.)

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/detectedServers/SocketProbe.Linux.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parseProcTcpRows, parseProcTcp6Rows } from "./Layers/SocketProbe.Linux.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "__fixtures__/proc", `${name}.txt`), "utf8");

describe("SocketProbe.Linux parsers", () => {
  it("parses LISTEN sockets from /proc/<pid>/net/tcp", () => {
    const rows = parseProcTcpRows(fixture("tcp"));
    const listening = rows.filter((r) => r.state === "LISTEN");
    expect(listening).toHaveLength(2);
    expect(listening[0]!.port).toBe(5201);
    expect(listening[0]!.host).toBe("127.0.0.1");
    expect(listening[1]!.port).toBe(5301);
    expect(listening[1]!.host).toBe("0.0.0.0");
  });

  it("excludes non-LISTEN rows", () => {
    const rows = parseProcTcpRows(fixture("tcp"));
    const established = rows.find((r) => r.state !== "LISTEN");
    expect(established?.port).toBe(5202);
  });

  it("parses LISTEN sockets from /proc/<pid>/net/tcp6", () => {
    const rows = parseProcTcp6Rows(fixture("tcp6"));
    const listening = rows.filter((r) => r.state === "LISTEN");
    expect(listening).toHaveLength(1);
    expect(listening[0]!.port).toBe(8080);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test --filter @ryco/server -- SocketProbe.Linux`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the parsers + layer**

Create `apps/server/src/detectedServers/Layers/SocketProbe.Linux.ts`:

```ts
import { Effect, Layer } from "effect";
import { readFile, readdir, readlink } from "node:fs/promises";
import { SocketProbe, type ProbeResult } from "./SocketProbe.ts";

export interface ProcTcpRow {
  inode: number;
  port: number;
  host: string;
  state: "LISTEN" | string;
}

const STATE_MAP: Record<string, "LISTEN"> = { "0A": "LISTEN" };

const hexToIpv4 = (hex: string): string => {
  // /proc reverses byte order: "0100007F" → "127.0.0.1"
  const bytes = [hex.slice(6, 8), hex.slice(4, 6), hex.slice(2, 4), hex.slice(0, 2)];
  return bytes.map((b) => Number.parseInt(b, 16)).join(".");
};

const hexToIpv6 = (hex: string): string => {
  if (hex === "00000000000000000000000000000000") return "::";
  const groups: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const start = i * 4;
    groups.push(hex.slice(start, start + 4).toLowerCase());
  }
  return groups.join(":");
};

export const parseProcTcpRows = (text: string): ProcTcpRow[] => {
  const lines = text
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    const [hostHex, portHex] = parts[1]!.split(":");
    const state = STATE_MAP[parts[3]!] ?? parts[3]!;
    return {
      inode: Number.parseInt(parts[9]!, 10),
      port: Number.parseInt(portHex!, 16),
      host: hexToIpv4(hostHex!),
      state,
    };
  });
};

export const parseProcTcp6Rows = (text: string): ProcTcpRow[] => {
  const lines = text
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    const [hostHex, portHex] = parts[1]!.split(":");
    const state = STATE_MAP[parts[3]!] ?? parts[3]!;
    return {
      inode: Number.parseInt(parts[9]!, 10),
      port: Number.parseInt(portHex!, 16),
      host: hostHex === "00000000000000000000000000000000" ? "::" : hexToIpv6(hostHex!),
      state,
    };
  });
};

const inodesForPid = (pid: number): Effect.Effect<ReadonlySet<number>> =>
  Effect.tryPromise({
    try: async () => {
      const fdDir = `/proc/${pid}/fd`;
      const entries = await readdir(fdDir);
      const inodes = new Set<number>();
      await Promise.all(
        entries.map(async (e) => {
          try {
            const target = await readlink(`${fdDir}/${e}`);
            const m = target.match(/^socket:\[(\d+)\]$/);
            if (m) inodes.add(Number.parseInt(m[1]!, 10));
          } catch {
            // fd may have closed between readdir and readlink — ignore
          }
        }),
      );
      return inodes;
    },
    catch: () => new Error("inode lookup failed"),
  }).pipe(Effect.orElseSucceed(() => new Set<number>()));

const probeImpl = (pids: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<ProbeResult>> =>
  Effect.gen(function* () {
    const pidInodes = yield* Effect.all(
      pids.map((pid) => Effect.map(inodesForPid(pid), (inodes) => ({ pid, inodes }))),
    );
    const inodeToPid = new Map<number, number>();
    for (const { pid, inodes } of pidInodes) {
      for (const inode of inodes) inodeToPid.set(inode, pid);
    }

    const tcpText = yield* Effect.tryPromise({
      try: () => readFile("/proc/net/tcp", "utf8"),
      catch: () => new Error("read /proc/net/tcp failed"),
    }).pipe(Effect.orElseSucceed(() => ""));
    const tcp6Text = yield* Effect.tryPromise({
      try: () => readFile("/proc/net/tcp6", "utf8"),
      catch: () => new Error("read /proc/net/tcp6 failed"),
    }).pipe(Effect.orElseSucceed(() => ""));

    const rows = [...parseProcTcpRows(tcpText), ...parseProcTcp6Rows(tcp6Text)];
    return rows
      .filter((r) => r.state === "LISTEN" && inodeToPid.has(r.inode))
      .map((r) => ({ pid: inodeToPid.get(r.inode)!, port: r.port, host: r.host }));
  });

export const SocketProbeLinuxLive = Layer.succeed(SocketProbe, { probe: probeImpl });
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun run test --filter @ryco/server -- SocketProbe.Linux`
Expected: all 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/detectedServers/Layers/SocketProbe.Linux.ts apps/server/src/detectedServers/SocketProbe.Linux.test.ts apps/server/src/detectedServers/__fixtures__/proc/
git commit -m "Add Linux SocketProbe via /proc/<pid>/net/tcp parsing"
```

---

### Task 10: Implement `SocketProbe.Darwin`

**Files:**

- Create: `apps/server/src/detectedServers/Layers/SocketProbe.Darwin.ts`
- Create: `apps/server/src/detectedServers/SocketProbe.Darwin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/detectedServers/SocketProbe.Darwin.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLsofOutput } from "./Layers/SocketProbe.Darwin.ts";

describe("SocketProbe.Darwin.parseLsofOutput", () => {
  it("parses lsof TCP LISTEN rows", () => {
    const output = `COMMAND   PID USER   FD  TYPE             DEVICE SIZE/OFF NODE NAME
node    12345 alice   23u  IPv4  0xabc12345abc1234      0t0  TCP 127.0.0.1:5173 (LISTEN)
node    12345 alice   24u  IPv6  0xabc12345abc1235      0t0  TCP [::1]:5173 (LISTEN)
node    99999 alice   25u  IPv4  0xabc12345abc1236      0t0  TCP *:3000 (LISTEN)
`;
    const rows = parseLsofOutput(output);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ pid: 12345, port: 5173, host: "127.0.0.1" });
    expect(rows[1]).toEqual({ pid: 12345, port: 5173, host: "::1" });
    expect(rows[2]).toEqual({ pid: 99999, port: 3000, host: "0.0.0.0" });
  });

  it("returns empty array for empty output", () => {
    expect(parseLsofOutput("")).toEqual([]);
  });

  it("ignores rows not in LISTEN state", () => {
    const output = `COMMAND   PID USER   FD  TYPE             DEVICE SIZE/OFF NODE NAME
node    12345 alice   23u  IPv4  0xabc12345abc1234      0t0  TCP 127.0.0.1:5173->127.0.0.1:99 (ESTABLISHED)
`;
    expect(parseLsofOutput(output)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter @ryco/server -- SocketProbe.Darwin`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement parser + layer**

Create `apps/server/src/detectedServers/Layers/SocketProbe.Darwin.ts`:

```ts
import { Effect, Layer } from "effect";
import { spawn } from "node:child_process";
import { SocketProbe, type ProbeResult } from "./SocketProbe.ts";

export const parseLsofOutput = (text: string): ProbeResult[] => {
  if (!text.trim()) return [];
  const lines = text.split("\n").slice(1);
  const out: ProbeResult[] = [];
  for (const line of lines) {
    if (!line.includes("(LISTEN)")) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const pid = Number.parseInt(parts[1]!, 10);
    const nameField = parts.slice(8, parts.length - 1).join(" ");
    let host = "0.0.0.0";
    let port = -1;
    const ipv6 = nameField.match(/^\[([^\]]+)\]:(\d+)/);
    const ipv4 = nameField.match(/^([^:]+):(\d+)/);
    if (ipv6) {
      host = ipv6[1]!;
      port = Number.parseInt(ipv6[2]!, 10);
    } else if (ipv4) {
      host = ipv4[1] === "*" ? "0.0.0.0" : ipv4[1]!;
      port = Number.parseInt(ipv4[2]!, 10);
    }
    if (port > 0) out.push({ pid, port, host });
  }
  return out;
};

const runLsof = (pids: ReadonlyArray<number>): Effect.Effect<string> =>
  Effect.async<string>((resume) => {
    if (pids.length === 0) {
      resume(Effect.succeed(""));
      return;
    }
    const child = spawn("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", pids.join(",")], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.on("data", (d: Buffer) => (buf += d.toString("utf8")));
    child.on("error", () => resume(Effect.succeed("")));
    child.on("close", () => resume(Effect.succeed(buf)));
  });

const probeImpl = (pids: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<ProbeResult>> =>
  Effect.gen(function* () {
    const out = yield* runLsof(pids);
    return parseLsofOutput(out);
  });

export const SocketProbeDarwinLive = Layer.succeed(SocketProbe, { probe: probeImpl });
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test --filter @ryco/server -- SocketProbe.Darwin`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/detectedServers/Layers/SocketProbe.Darwin.ts apps/server/src/detectedServers/SocketProbe.Darwin.test.ts
git commit -m "Add Darwin SocketProbe via lsof"
```

---

### Task 11: Implement `SocketProbe.Windows`

**Files:**

- Create: `apps/server/src/detectedServers/Layers/SocketProbe.Windows.ts`
- Create: `apps/server/src/detectedServers/SocketProbe.Windows.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/detectedServers/SocketProbe.Windows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseNetstatOutput } from "./Layers/SocketProbe.Windows.ts";

describe("SocketProbe.Windows.parseNetstatOutput", () => {
  it("parses LISTENING rows", () => {
    const output = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       9876
  TCP    127.0.0.1:5173         127.0.0.1:54321        ESTABLISHED     9876
`;
    const rows = parseNetstatOutput(output);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ pid: 1234, port: 135, host: "0.0.0.0" });
    expect(rows[1]).toEqual({ pid: 9876, port: 5173, host: "127.0.0.1" });
  });

  it("handles IPv6 brackets", () => {
    const output = `
  TCP    [::]:8080              [::]:0                 LISTENING       4242
`;
    const rows = parseNetstatOutput(output);
    expect(rows).toEqual([{ pid: 4242, port: 8080, host: "::" }]);
  });

  it("returns empty for no LISTENING rows", () => {
    expect(parseNetstatOutput("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter @ryco/server -- SocketProbe.Windows`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement parser + layer**

Create `apps/server/src/detectedServers/Layers/SocketProbe.Windows.ts`:

```ts
import { Effect, Layer } from "effect";
import { spawn } from "node:child_process";
import { SocketProbe, type ProbeResult } from "./SocketProbe.ts";

export const parseNetstatOutput = (text: string): ProbeResult[] => {
  if (!text.trim()) return [];
  const out: ProbeResult[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("TCP")) continue;
    if (!line.includes("LISTENING")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const local = parts[1]!;
    const pid = Number.parseInt(parts[4]!, 10);
    let host: string;
    let port: number;
    if (local.startsWith("[")) {
      const m = local.match(/^\[([^\]]+)\]:(\d+)$/);
      if (!m) continue;
      host = m[1]!;
      port = Number.parseInt(m[2]!, 10);
    } else {
      const idx = local.lastIndexOf(":");
      if (idx < 0) continue;
      host = local.slice(0, idx);
      port = Number.parseInt(local.slice(idx + 1), 10);
    }
    if (Number.isFinite(pid) && Number.isFinite(port)) out.push({ pid, port, host });
  }
  return out;
};

const runNetstat = (): Effect.Effect<string> =>
  Effect.async<string>((resume) => {
    const child = spawn("netstat", ["-ano"], { stdio: ["ignore", "pipe", "ignore"] });
    let buf = "";
    child.stdout.on("data", (d: Buffer) => (buf += d.toString("utf8")));
    child.on("error", () => resume(Effect.succeed("")));
    child.on("close", () => resume(Effect.succeed(buf)));
  });

const probeImpl = (pids: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<ProbeResult>> =>
  Effect.gen(function* () {
    if (pids.length === 0) return [];
    const out = yield* runNetstat();
    const pidSet = new Set(pids);
    return parseNetstatOutput(out).filter((r) => pidSet.has(r.pid));
  });

export const SocketProbeWindowsLive = Layer.succeed(SocketProbe, { probe: probeImpl });
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test --filter @ryco/server -- SocketProbe.Windows`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/detectedServers/Layers/SocketProbe.Windows.ts apps/server/src/detectedServers/SocketProbe.Windows.test.ts
git commit -m "Add Windows SocketProbe via netstat -ano"
```

---

### Task 12: Add OS-selecting `SocketProbe` layer

**Files:**

- Modify: `apps/server/src/detectedServers/Layers/SocketProbe.ts`

- [ ] **Step 1: Add the runtime OS selector**

At the bottom of `apps/server/src/detectedServers/Layers/SocketProbe.ts`, append:

```ts
import { Effect, Layer } from "effect";
import { platform } from "node:os";
import { SocketProbeLinuxLive } from "./SocketProbe.Linux.ts";
import { SocketProbeDarwinLive } from "./SocketProbe.Darwin.ts";
import { SocketProbeWindowsLive } from "./SocketProbe.Windows.ts";

const NoopProbeLive = Layer.succeed(SocketProbe, {
  probe: () => Effect.succeed([] as ReadonlyArray<ProbeResult>),
});

export const SocketProbeLive: Layer.Layer<SocketProbe> = (() => {
  switch (platform()) {
    case "linux":
      return SocketProbeLinuxLive;
    case "darwin":
      return SocketProbeDarwinLive;
    case "win32":
      return SocketProbeWindowsLive;
    default:
      return NoopProbeLive;
  }
})();
```

(The top of the file already imports `Effect, Context`; restructure imports if needed so the file has only one `import { Effect, ... } from "effect"` block. The `Layer` import can be merged into the existing `effect` import.)

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/detectedServers/Layers/SocketProbe.ts
git commit -m "Add runtime OS-selecting SocketProbe layer"
```

---

## Phase 4 — Liveness + ingress composition

### Task 13: Implement `LivenessHeartbeat`

**Files:**

- Create: `apps/server/src/detectedServers/Layers/LivenessHeartbeat.ts`

- [ ] **Step 1: Implement the service**

Create `apps/server/src/detectedServers/Layers/LivenessHeartbeat.ts`:

```ts
import { Effect, Context, Layer } from "effect";

export interface LivenessHeartbeatShape {
  /**
   * Single liveness check. Returns true if any HTTP response was received
   * (any 2xx/3xx/4xx/5xx counts as "the server is up").
   */
  readonly check: (url: string) => Effect.Effect<boolean>;
}

export class LivenessHeartbeat extends Context.Service<LivenessHeartbeat, LivenessHeartbeatShape>()(
  "s3/detectedServers/Layers/LivenessHeartbeat",
) {}

const checkImpl = (url: string): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: () => fetch(url, { method: "HEAD", signal: AbortSignal.timeout(500) }),
    catch: () => new Error("heartbeat failed"),
  }).pipe(
    Effect.map(() => true),
    Effect.orElseSucceed(() => false),
  );

export const LivenessHeartbeatLive = Layer.succeed(LivenessHeartbeat, { check: checkImpl });
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/detectedServers/Layers/LivenessHeartbeat.ts
git commit -m "Add LivenessHeartbeat service for HEAD-probe checks"
```

---

### Task 14: Define `DetectedServerRegistry` Service tag wrapping the in-memory `Registry`

**Files:**

- Create: `apps/server/src/detectedServers/Services/DetectedServerRegistry.ts`

- [ ] **Step 1: Create the service tag and Layer**

Create `apps/server/src/detectedServers/Services/DetectedServerRegistry.ts`:

```ts
import { Effect, Context, Layer } from "effect";
import type { DetectedServer, DetectedServerEvent } from "@ryco/contracts";
import { Registry, type RegistryRegisterInput } from "../Layers/Registry.ts";

export interface DetectedServerRegistryShape {
  readonly registerOrUpdate: (input: RegistryRegisterInput) => Effect.Effect<DetectedServer>;
  readonly publishLog: (serverId: string, data: string) => Effect.Effect<void>;
  readonly remove: (serverId: string) => Effect.Effect<void>;
  readonly subscribe: (
    threadId: string,
    listener: (e: DetectedServerEvent) => void,
  ) => Effect.Effect<() => void>;
  readonly getCurrent: (threadId: string) => Effect.Effect<ReadonlyArray<DetectedServer>>;
  readonly findById: (serverId: string) => Effect.Effect<DetectedServer | undefined>;
}

export class DetectedServerRegistry extends Context.Service<
  DetectedServerRegistry,
  DetectedServerRegistryShape
>()("s3/detectedServers/Services/DetectedServerRegistry") {}

export const DetectedServerRegistryLive = Layer.sync(DetectedServerRegistry, () => {
  const r = new Registry();
  return {
    registerOrUpdate: (input) => Effect.sync(() => r.registerOrUpdate(input)),
    publishLog: (id, data) => Effect.sync(() => r.publishLog(id, data)),
    remove: (id) => Effect.sync(() => r.remove(id)),
    subscribe: (tid, listener) => Effect.sync(() => r.subscribe(tid, listener)),
    getCurrent: (tid) => Effect.sync(() => r.getCurrent(tid)),
    findById: (id) => Effect.sync(() => r.findById(id)),
  };
});
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/detectedServers/Services/DetectedServerRegistry.ts
git commit -m "Add DetectedServerRegistry Effect Service wrapping the in-memory Registry"
```

---

### Task 15: Build `DetectedServersIngress` layer composing everything

**Files:**

- Create: `apps/server/src/detectedServers/Layers/DetectedServersIngress.ts`
- Modify: `apps/server/src/serverLayers.ts`

- [ ] **Step 1: Build the orchestrator**

Create `apps/server/src/detectedServers/Layers/DetectedServersIngress.ts`:

```ts
import { Effect, Layer, Fiber, Ref, Schedule, Duration } from "effect";
import pidtree from "pidtree";
import { DetectedServerRegistry } from "../Services/DetectedServerRegistry.ts";
import { SocketProbe } from "./SocketProbe.ts";
import { LivenessHeartbeat } from "./LivenessHeartbeat.ts";
import { StdoutSniffer } from "./StdoutSniffer.ts";
import { hintFromArgv, type PackageJsonShape } from "./ArgvHinter.ts";

const DEBUGGER_PORTS = new Set([9229, 9230]);

const argvHasInspect = (argv: ReadonlyArray<string>): number[] => {
  const out: number[] = [];
  for (const t of argv) {
    const m = t.match(/--inspect(?:-brk|-wait)?=(?:[^:]*:)?(\d+)/);
    if (m) out.push(Number.parseInt(m[1]!, 10));
  }
  return out;
};

export interface CodexCommandSource {
  threadId: string;
  turnId: string;
  itemId: string;
  argv: ReadonlyArray<string>;
  cwd: string;
}

export interface PtyCommandSource {
  threadId: string;
  pid: number;
  argv: ReadonlyArray<string>;
  cwd: string;
}

export interface DetectedServersIngressShape {
  /**
   * Begin tracking a Codex/ACP agent-internal command.
   * Returns a feed() function for stdout chunks and an end() function for command completion.
   */
  readonly trackAgentCommand: (
    source: CodexCommandSource,
    sourceKind: "codex" | "acp",
    pkg: PackageJsonShape | undefined,
  ) => Effect.Effect<{
    feed: (chunk: string) => void;
    end: (result: "success" | "error") => void;
  }>;

  /**
   * Begin tracking a local PTY spawn.
   * Returns a feed() function for stdout chunks and an end() function for process exit.
   */
  readonly trackPty: (
    source: PtyCommandSource,
    pkg: PackageJsonShape | undefined,
  ) => Effect.Effect<{
    feed: (chunk: string) => void;
    end: (exitCode: number | null) => void;
  }>;
}

export class DetectedServersIngress extends Effect.Service<DetectedServersIngress>()(
  "s3/detectedServers/Layers/DetectedServersIngress",
  {
    effect: Effect.gen(function* () {
      const registry = yield* DetectedServerRegistry;
      const probe = yield* SocketProbe;
      const heartbeat = yield* LivenessHeartbeat;

      const trackAgentCommand = (
        source: CodexCommandSource,
        sourceKind: "codex" | "acp",
        pkg: PackageJsonShape | undefined,
      ) =>
        Effect.gen(function* () {
          const hint = hintFromArgv(source.argv, pkg);
          if (!hint.isLikelyServer) {
            return { feed: () => {}, end: () => {} };
          }
          const identityKey = `${source.threadId}::${sourceKind}::${source.turnId}::${source.itemId}`;
          const server = yield* registry.registerOrUpdate({
            threadId: source.threadId,
            source: sourceKind,
            identityKey,
            patch: {
              framework: hint.framework,
              status: "predicted",
              argv: source.argv,
              cwd: source.cwd,
            },
          });
          const sniffer = new StdoutSniffer();
          sniffer.onCandidate((c) => {
            Effect.runPromise(
              registry.registerOrUpdate({
                threadId: source.threadId,
                source: sourceKind,
                identityKey,
                patch: {
                  status: "candidate",
                  framework: c.framework !== "unknown" ? c.framework : hint.framework,
                  url: c.url,
                  port: c.port,
                  host: c.host,
                },
              }),
            ).catch(() => {});
          });

          return {
            feed: (chunk: string) => {
              sniffer.feed(chunk);
              Effect.runPromise(registry.publishLog(server.id, chunk)).catch(() => {});
            },
            end: (result: "success" | "error") => {
              Effect.runPromise(
                registry.registerOrUpdate({
                  threadId: source.threadId,
                  source: sourceKind,
                  identityKey,
                  patch: {
                    status: "exited",
                    exitedAt: new Date(),
                    exitReason: result === "success" ? "stopped" : "crashed",
                  },
                }),
              ).catch(() => {});
            },
          };
        });

      const trackPty = (source: PtyCommandSource, pkg: PackageJsonShape | undefined) =>
        Effect.gen(function* () {
          const hint = hintFromArgv(source.argv, pkg);
          if (!hint.isLikelyServer) return { feed: () => {}, end: () => {} };
          const identityKey = `${source.threadId}::pty::${source.pid}`;
          const server = yield* registry.registerOrUpdate({
            threadId: source.threadId,
            source: "pty",
            identityKey,
            patch: {
              framework: hint.framework,
              status: "predicted",
              pid: source.pid,
              argv: source.argv,
              cwd: source.cwd,
            },
          });

          const sniffer = new StdoutSniffer();
          let sniffedPort: number | null = null;
          sniffer.onCandidate((c) => {
            sniffedPort = c.port;
            Effect.runPromise(
              registry.registerOrUpdate({
                threadId: source.threadId,
                source: "pty",
                identityKey,
                patch: {
                  status: "candidate",
                  framework: c.framework !== "unknown" ? c.framework : hint.framework,
                  url: c.url,
                  port: c.port,
                  host: c.host,
                },
              }),
            ).catch(() => {});
          });

          const denyPorts = new Set<number>([...DEBUGGER_PORTS, ...argvHasInspect(source.argv)]);
          const probeKey = `${source.threadId}::${server.id}`;

          // Start probe fiber
          const probeFiber = yield* Effect.fork(
            Effect.gen(function* () {
              let liveSeenAt: Date | null = null;
              while (true) {
                const pids = yield* Effect.tryPromise({
                  try: () => pidtree(source.pid, { root: true }),
                  catch: () => new Error("pidtree failed"),
                }).pipe(Effect.orElseSucceed(() => [source.pid]));
                const rows = yield* probe.probe(pids);
                const candidates = rows.filter((r) => !denyPorts.has(r.port));
                const matching = sniffedPort
                  ? candidates.find((r) => r.port === sniffedPort)
                  : candidates[0];
                if (matching && !liveSeenAt) {
                  const ok = yield* heartbeat.check(`http://localhost:${matching.port}`);
                  if (ok) {
                    liveSeenAt = new Date();
                    yield* registry.registerOrUpdate({
                      threadId: source.threadId,
                      source: "pty",
                      identityKey,
                      patch: {
                        status: "live",
                        port: matching.port,
                        host: matching.host,
                        url: `http://localhost:${matching.port}`,
                        liveAt: liveSeenAt,
                      },
                    });
                  } else {
                    yield* registry.registerOrUpdate({
                      threadId: source.threadId,
                      source: "pty",
                      identityKey,
                      patch: {
                        status: "confirmed",
                        port: matching.port,
                        host: matching.host,
                      },
                    });
                  }
                }
                yield* Effect.sleep(liveSeenAt ? Duration.seconds(2) : Duration.millis(250));
              }
            }),
          );

          return {
            feed: (chunk: string) => {
              sniffer.feed(chunk);
              Effect.runPromise(registry.publishLog(server.id, chunk)).catch(() => {});
            },
            end: (exitCode: number | null) => {
              Effect.runPromise(Fiber.interrupt(probeFiber)).catch(() => {});
              Effect.runPromise(
                registry.registerOrUpdate({
                  threadId: source.threadId,
                  source: "pty",
                  identityKey,
                  patch: {
                    status: exitCode === 0 || exitCode === null ? "exited" : "crashed",
                    exitedAt: new Date(),
                    exitReason: exitCode === 0 || exitCode === null ? "stopped" : "crashed",
                  },
                }),
              ).catch(() => {});
            },
          };
        });

      return { trackAgentCommand, trackPty };
    }),
    dependencies: [],
  },
) {}
```

(If `Effect.Service` static-builder syntax doesn't match this codebase's pattern, port to the explicit `Context.Service` + `Layer.effect` two-step form used in `terminal/Services/PTY.ts`. The shape stays identical.)

- [ ] **Step 2: Wire the ingress + dependencies into `serverLayers.ts`**

Modify `apps/server/src/serverLayers.ts` — locate the existing layer composition for terminal services. Add:

```ts
import { SocketProbeLive } from "./detectedServers/Layers/SocketProbe.ts";
import { LivenessHeartbeatLive } from "./detectedServers/Layers/LivenessHeartbeat.ts";
import { DetectedServerRegistryLive } from "./detectedServers/Services/DetectedServerRegistry.ts";
import { DetectedServersIngress } from "./detectedServers/Layers/DetectedServersIngress.ts";

// ... within the layer build:
const detectedServersLayer = Layer.mergeAll(
  SocketProbeLive,
  LivenessHeartbeatLive,
  DetectedServerRegistryLive,
  DetectedServersIngress.Default,
);
```

Merge `detectedServersLayer` into the main `serverLayers` composition next to the terminal layer block.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Run all server tests**

Run: `bun run test --filter @ryco/server`
Expected: pre-existing tests still PASS; new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/detectedServers/Layers/DetectedServersIngress.ts apps/server/src/serverLayers.ts
git commit -m "Compose DetectedServersIngress with probe, heartbeat, and registry"
```

---

## Phase 5 — Provider taps

### Task 16: Tap Codex provider

**Files:**

- Modify: `apps/server/src/provider/Layers/CodexSessionRuntime.ts`

- [ ] **Step 1: Inspect the existing notification routing**

Open `apps/server/src/provider/Layers/CodexSessionRuntime.ts` and locate:

- Handler for `item/commandExecution/requestApproval` (~lines 917-971 per the spec).
- Handler for `item/commandExecution/outputDelta` (~lines 549-550 per the spec).

- [ ] **Step 2: Inject `DetectedServersIngress` into the runtime**

At the top of `CodexSessionRuntime.ts`, add:

```ts
import { DetectedServersIngress } from "../../detectedServers/Layers/DetectedServersIngress.ts";
```

Add it as a dependency of the runtime construction (alongside other services already pulled with `yield* …`). Maintain a `Map<string, { feed; end }>` keyed by `${turnId}::${itemId}` inside the runtime state.

- [ ] **Step 3: Hook `requestApproval`**

In the existing `requestApproval` handler, after the user approval payload is parsed (where `argv` and `cwd` are available), call:

```ts
const tracker =
  yield *
  ingress.trackAgentCommand(
    { threadId, turnId, itemId, argv, cwd },
    "codex",
    /* pkg */ undefined, // package.json read can be added later; undefined is safe
  );
trackerMap.set(`${turnId}::${itemId}`, tracker);
```

- [ ] **Step 4: Hook `outputDelta`**

In the `outputDelta` handler, after locating the matching `(turnId, itemId)`:

```ts
const tracker = trackerMap.get(`${turnId}::${itemId}`);
tracker?.feed(payload.delta);
```

(Adapt `payload.delta` to whatever the actual field name is — likely `payload.text` or `payload.output`. Grep the file for the existing accessor.)

- [ ] **Step 5: Hook command completion**

Find the existing handler for command-execution completion (search for `commandExecution/end` or `commandExecution/result` or whatever the actual notification method is). On completion:

```ts
const tracker = trackerMap.get(`${turnId}::${itemId}`);
tracker?.end(payload.exitedSuccessfully ? "success" : "error");
trackerMap.delete(`${turnId}::${itemId}`);
```

- [ ] **Step 6: Run typecheck and existing tests**

Run: `bun run typecheck && bun run test --filter @ryco/server -- CodexSessionRuntime`
Expected: no errors; existing CodexSessionRuntime tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/provider/Layers/CodexSessionRuntime.ts
git commit -m "Tap Codex command execution events for detected-server tracking"
```

---

### Task 17: Tap ACP provider (Claude/Cursor)

**Files:**

- Modify: `apps/server/src/provider/acp/AcpSessionRuntime.ts`

- [ ] **Step 1: Inspect the existing ACP command-execution event shape**

Open `apps/server/src/provider/acp/AcpSessionRuntime.ts` and locate the command-execution notification handler. Likely uses the same conceptual events as Codex but with ACP-specific naming. Grep the file for `commandExecution`, `tool`, `bash`, and similar tokens to find the right hook.

- [ ] **Step 2: Mirror the Codex tap**

Add `DetectedServersIngress` as a dependency, maintain a per-(turnId, itemId) tracker map, hook approval/output/completion analogously. Use `"acp"` as the `sourceKind`.

```ts
import { DetectedServersIngress } from "../../detectedServers/Layers/DetectedServersIngress.ts";

// at the right call site:
const tracker =
  yield * ingress.trackAgentCommand({ threadId, turnId, itemId, argv, cwd }, "acp", undefined);
trackerMap.set(`${turnId}::${itemId}`, tracker);

// on output:
trackerMap.get(`${turnId}::${itemId}`)?.feed(text);

// on completion:
trackerMap.get(`${turnId}::${itemId}`)?.end(success ? "success" : "error");
trackerMap.delete(`${turnId}::${itemId}`);
```

- [ ] **Step 3: Run typecheck and tests**

Run: `bun run typecheck && bun run test --filter @ryco/server -- AcpSessionRuntime`
Expected: no errors; existing tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/provider/acp/AcpSessionRuntime.ts
git commit -m "Tap ACP command execution events for detected-server tracking"
```

---

### Task 18: Tap local PTY (terminal + OpenCode)

**Files:**

- Modify: `apps/server/src/terminal/Layers/Manager.ts`

- [ ] **Step 1: Locate the PTY spawn site**

Open `apps/server/src/terminal/Layers/Manager.ts`. Find the spot where `PtyAdapter.spawn` is awaited and the returned `PtyProcess` is attached. Per the spec, around lines 1389-1405.

- [ ] **Step 2: Inject the ingress and instantiate a tracker per spawn**

Import:

```ts
import { DetectedServersIngress } from "../../detectedServers/Layers/DetectedServersIngress.ts";
```

Pull it as a service dependency in the manager's effect:

```ts
const ingress = yield * DetectedServersIngress;
```

After the `PtyProcess` is created and you know `pid`, `argv`, `cwd`:

```ts
const tracker =
  yield *
  ingress.trackPty(
    { threadId: session.threadId, pid: pty.pid, argv: shellArgs, cwd: session.cwd },
    undefined,
  );
```

Where `shellArgs` is the array `[session.shell, ...session.args]` or whatever the actual argv is at the spawn site.

- [ ] **Step 3: Hook PTY data into the tracker**

In `drainProcessEvents` (around `Manager.ts:1158-1267` per the spec), where `output` events are processed, add:

```ts
tracker.feed(event.data);
```

— alongside the existing publishEvent / history append.

- [ ] **Step 4: Hook PTY exit**

In the exit handling path, add:

```ts
tracker.end(event.exitCode ?? null);
```

- [ ] **Step 5: Run typecheck and tests**

Run: `bun run typecheck && bun run test --filter @ryco/server -- terminal`
Expected: no errors; existing terminal tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/terminal/Layers/Manager.ts
git commit -m "Tap local PTY events for detected-server tracking"
```

---

## Phase 6 — WS surface

### Task 19: Wire `detectedServers.event` push channel + RPC handlers

**Files:**

- Modify: `apps/server/src/wsServer.ts`

- [ ] **Step 1: Inspect existing RPC + push wiring**

Search for `subscribeTerminalEvents` in `apps/server/src/wsServer.ts`. Note:

- How the streaming RPC handler is registered.
- How the push channel envelope is constructed and routed through `ServerPushBus`.

- [ ] **Step 2: Add the streaming subscribe handler**

In `wsServer.ts` near `subscribeTerminalEvents`, register `subscribeDetectedServerEvents`:

```ts
import { DetectedServerRegistry } from "./detectedServers/Services/DetectedServerRegistry.ts";
import { open as openInBrowser } from "./open.ts";

// ...inside the handler registration block:
registerHandler("subscribeDetectedServerEvents", ({ threadId }) =>
  Effect.gen(function* () {
    const registry = yield* DetectedServerRegistry;
    return Stream.async<DetectedServerEvent>((emit) => {
      // Replay current state first
      Effect.runPromise(registry.getCurrent(threadId)).then((current) => {
        for (const server of current) {
          emit.single({
            type: "registered",
            threadId,
            server,
            createdAt: new Date().toISOString(),
          });
        }
      });
      // Then stream live events
      const unsubscribePromise = Effect.runPromise(
        registry.subscribe(threadId, (e) => emit.single(e)),
      );
      return Effect.promise(() => unsubscribePromise.then((fn) => Effect.sync(fn)));
    });
  }),
);
```

(Adapt the streaming-handler signature to the exact pattern used by `subscribeTerminalEvents` — the codebase may use `Effect.Stream`, `Effect.async`, or a custom shape.)

- [ ] **Step 3: Add `detectedServers.stop` handler**

```ts
registerHandler("detectedServers.stop", ({ serverId }) =>
  Effect.gen(function* () {
    const registry = yield* DetectedServerRegistry;
    const terminalMgr = yield* TerminalManager;
    // Look up server by id — scan all threads.
    // (For v1, registry exposes getCurrent per thread; iterate threads via a new
    // method `findById` if not present. Add `findById` to Registry + service if needed.)
    const server = yield* registry.findById(serverId);
    if (!server) return { kind: "not-stoppable", hint: "interrupt-turn" } as const;
    if (server.source === "pty" && server.pid !== undefined) {
      // Find owning terminal session and call stop. The terminal manager
      // already has SIGTERM→SIGKILL escalation.
      yield* terminalMgr.stopByPid(server.pid);
      return { kind: "stopped" } as const;
    }
    return { kind: "not-stoppable", hint: "interrupt-turn" } as const;
  }),
);
```

If `Registry.findById` and `TerminalManager.stopByPid` don't exist, add them: `findById` is a flat scan of all threads' maps (small N); `stopByPid` walks the manager's session map and invokes the existing kill path on the matching session.

- [ ] **Step 4: Add `detectedServers.openInBrowser` handler**

```ts
registerHandler("detectedServers.openInBrowser", ({ serverId }) =>
  Effect.gen(function* () {
    const registry = yield* DetectedServerRegistry;
    const server = yield* registry.findById(serverId);
    if (!server?.url) return { ok: false };
    yield* Effect.tryPromise(() => openInBrowser(server.url!));
    return { ok: true };
  }),
);
```

- [ ] **Step 5: Run typecheck and existing server tests**

Run: `bun run typecheck && bun run test --filter @ryco/server`
Expected: no errors; pre-existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/wsServer.ts apps/server/src/detectedServers/Services/DetectedServerRegistry.ts apps/server/src/detectedServers/Layers/Registry.ts
git commit -m "Wire detectedServers RPC handlers (subscribe, stop, openInBrowser)"
```

---

## Phase 7 — Backend integration tests

### Task 20: Codex synthetic integration test

**Files:**

- Create: `apps/server/integration/detectedServersCodex.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create the test:

```ts
import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { TestProviderAdapter } from "./TestProviderAdapter.integration.ts";
import { DetectedServerRegistryLive } from "../src/detectedServers/Services/DetectedServerRegistry.ts";
import { DetectedServerRegistry } from "../src/detectedServers/Services/DetectedServerRegistry.ts";
import { SocketProbeLive } from "../src/detectedServers/Layers/SocketProbe.ts";
import { LivenessHeartbeatLive } from "../src/detectedServers/Layers/LivenessHeartbeat.ts";
import { DetectedServersIngress } from "../src/detectedServers/Layers/DetectedServersIngress.ts";

describe("DetectedServers / Codex synthetic", () => {
  it("transitions predicted → candidate on Vite-shaped outputDelta", async () => {
    const testLayer = Layer.mergeAll(
      DetectedServerRegistryLive,
      SocketProbeLive,
      LivenessHeartbeatLive,
      DetectedServersIngress.Default,
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const ingress = yield* DetectedServersIngress;
        const registry = yield* DetectedServerRegistry;
        const tracker = yield* ingress.trackAgentCommand(
          {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-1",
            argv: ["vite"],
            cwd: "/tmp",
          },
          "codex",
          undefined,
        );
        tracker.feed("  ➜  Local:   http://localhost:5173/\n");
        // Allow the async sniffer callback to flush
        await new Promise((r) => setTimeout(r, 50));
        const current = yield* registry.getCurrent("thread-1");
        expect(current).toHaveLength(1);
        expect(current[0]!.status).toBe("candidate");
        expect(current[0]!.url).toBe("http://localhost:5173/");
        expect(current[0]!.framework).toBe("vite");
      }).pipe(Effect.provide(testLayer)),
    );
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun run test --filter @ryco/server -- detectedServersCodex`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/server/integration/detectedServersCodex.integration.test.ts
git commit -m "Add Codex synthetic integration test for detected servers"
```

---

### Task 21: PTY real-server integration test

**Files:**

- Create: `apps/server/integration/detectedServersPty.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { spawn } from "node:child_process";
import {
  DetectedServerRegistryLive,
  DetectedServerRegistry,
} from "../src/detectedServers/Services/DetectedServerRegistry.ts";
import { SocketProbeLive } from "../src/detectedServers/Layers/SocketProbe.ts";
import { LivenessHeartbeatLive } from "../src/detectedServers/Layers/LivenessHeartbeat.ts";
import { DetectedServersIngress } from "../src/detectedServers/Layers/DetectedServersIngress.ts";

describe("DetectedServers / PTY real server", () => {
  it("transitions predicted → candidate → confirmed → live for a real Node http server", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const http = require("node:http"); const s = http.createServer((req,res)=>res.end("ok")); s.listen(0, "127.0.0.1", () => { console.log("Server listening on port " + s.address().port); });`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    try {
      const testLayer = Layer.mergeAll(
        DetectedServerRegistryLive,
        SocketProbeLive,
        LivenessHeartbeatLive,
        DetectedServersIngress.Default,
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const ingress = yield* DetectedServersIngress;
          const registry = yield* DetectedServerRegistry;
          const tracker = yield* ingress.trackPty(
            { threadId: "thread-1", pid: child.pid!, argv: ["node", "-e", "..."], cwd: "/tmp" },
            { scripts: { dev: "node -e foo" } }, // mark as a dev-ish command
          );
          child.stdout.on("data", (d) => tracker.feed(d.toString("utf8")));

          // Poll for live with timeout
          let server = null;
          for (let i = 0; i < 100; i += 1) {
            await new Promise((r) => setTimeout(r, 100));
            const current = yield* registry.getCurrent("thread-1");
            if (current[0]?.status === "live") {
              server = current[0];
              break;
            }
          }
          expect(server).not.toBeNull();
          expect(server!.status).toBe("live");
          expect(server!.port).toBeGreaterThan(0);
        }).pipe(Effect.provide(testLayer)),
      );
    } finally {
      child.kill();
    }
  }, 15_000);
});
```

Note: this test currently relies on the ArgvHinter recognising the command. Since `node -e ...` isn't a known framework token, the test stubs in a fake `pkg` with a `scripts.dev` entry to coerce the hint. Alternatively, expand ArgvHinter to treat `node -e` invocations as `unknown, isLikelyServer: true` when run under a PTY whose parent is an agent — but for v1, the explicit stub is fine.

- [ ] **Step 2: Run the test on Linux/macOS**

Run: `bun run test --filter @ryco/server -- detectedServersPty`
Expected: PASS within ~5 seconds on Linux/macOS. Skip on Windows (mark `it.skipIf(process.platform === 'win32')`) if `netstat -ano` parsing isn't viable in CI.

- [ ] **Step 3: Commit**

```bash
git add apps/server/integration/detectedServersPty.integration.test.ts
git commit -m "Add PTY real-server integration test for detected servers"
```

---

## Phase 8 — Web foundations

### Task 22: Add `detectedServerStore` Zustand slice

**Files:**

- Create: `apps/web/src/detectedServerStore.ts`
- Create: `apps/web/src/detectedServerStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/detectedServerStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useDetectedServerStore } from "./detectedServerStore.ts";

describe("detectedServerStore", () => {
  beforeEach(() => useDetectedServerStore.getState().__reset());

  it("registered adds a server to the thread map", () => {
    const store = useDetectedServerStore.getState();
    store.handleEvent("t1", {
      type: "registered",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:00Z",
      server: {
        id: "s1",
        threadId: "t1",
        source: "pty",
        framework: "vite",
        status: "predicted",
        startedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    expect(useDetectedServerStore.getState().serversByThreadKey["t1"]?.size).toBe(1);
  });

  it("updated mutates an existing server", () => {
    const store = useDetectedServerStore.getState();
    store.handleEvent("t1", {
      type: "registered",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:00Z",
      server: {
        id: "s1",
        threadId: "t1",
        source: "pty",
        framework: "vite",
        status: "predicted",
        startedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    store.handleEvent("t1", {
      type: "updated",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:01Z",
      serverId: "s1",
      patch: { status: "live", url: "http://localhost:5173/" },
    });
    const server = useDetectedServerStore.getState().serversByThreadKey["t1"]!.get("s1");
    expect(server?.status).toBe("live");
    expect(server?.url).toBe("http://localhost:5173/");
  });

  it("log appends to the per-server buffer with a cap", () => {
    const store = useDetectedServerStore.getState();
    store.handleEvent("t1", {
      type: "registered",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:00Z",
      server: {
        id: "s1",
        threadId: "t1",
        source: "pty",
        framework: "vite",
        status: "predicted",
        startedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    store.handleEvent("t1", {
      type: "log",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:01Z",
      serverId: "s1",
      data: "hello\nworld\n",
    });
    const buf = useDetectedServerStore.getState().logBuffersByServerId.get("s1");
    expect(buf?.snapshot()).toEqual(["hello", "world"]);
  });

  it("removed drops the server and its log buffer", () => {
    const store = useDetectedServerStore.getState();
    store.handleEvent("t1", {
      type: "registered",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:00Z",
      server: {
        id: "s1",
        threadId: "t1",
        source: "pty",
        framework: "vite",
        status: "predicted",
        startedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    store.handleEvent("t1", {
      type: "removed",
      threadId: "t1",
      createdAt: "2026-05-13T00:00:02Z",
      serverId: "s1",
    });
    expect(useDetectedServerStore.getState().serversByThreadKey["t1"]?.size ?? 0).toBe(0);
    expect(useDetectedServerStore.getState().logBuffersByServerId.has("s1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter @ryco/web -- detectedServerStore`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the store**

Create `apps/web/src/detectedServerStore.ts`:

```ts
import { create } from "zustand";
import type { DetectedServer, DetectedServerEvent } from "@ryco/contracts";
import { LineBuffer } from "@ryco/shared/lineBuffer";

const MAX_LOG_LINES = 5000;

interface State {
  serversByThreadKey: Record<string, Map<string, DetectedServer>>;
  logBuffersByServerId: Map<string, LineBuffer>;
  activeServerIdByThreadKey: Record<string, string | null>;
  handleEvent: (threadKey: string, event: DetectedServerEvent) => void;
  setActive: (threadKey: string, serverId: string | null) => void;
  __reset: () => void;
}

export const useDetectedServerStore = create<State>((set, get) => ({
  serversByThreadKey: {},
  logBuffersByServerId: new Map(),
  activeServerIdByThreadKey: {},

  handleEvent: (threadKey, event) => {
    const next = { ...get().serversByThreadKey };
    const map = new Map(next[threadKey] ?? []);
    const logs = new Map(get().logBuffersByServerId);

    if (event.type === "registered") {
      map.set(event.server.id, event.server);
      if (!logs.has(event.server.id)) {
        logs.set(event.server.id, new LineBuffer({ maxLines: MAX_LOG_LINES }));
      }
    } else if (event.type === "updated") {
      const existing = map.get(event.serverId);
      if (existing) map.set(event.serverId, { ...existing, ...event.patch });
    } else if (event.type === "log") {
      const buf = logs.get(event.serverId);
      buf?.write(event.data);
    } else if (event.type === "removed") {
      map.delete(event.serverId);
      logs.delete(event.serverId);
    }

    next[threadKey] = map;
    set({ serversByThreadKey: next, logBuffersByServerId: logs });
  },

  setActive: (threadKey, serverId) =>
    set({
      activeServerIdByThreadKey: { ...get().activeServerIdByThreadKey, [threadKey]: serverId },
    }),

  __reset: () =>
    set({
      serversByThreadKey: {},
      logBuffersByServerId: new Map(),
      activeServerIdByThreadKey: {},
    }),
}));
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test --filter @ryco/web -- detectedServerStore`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/detectedServerStore.ts apps/web/src/detectedServerStore.test.ts
git commit -m "Add detectedServerStore Zustand slice"
```

---

### Task 23: Subscribe to detected-server events in the WS RPC client

**Files:**

- Modify: `apps/web/src/rpc/wsRpcClient.ts`

- [ ] **Step 1: Inspect existing terminal subscription pattern**

Search `apps/web/src/rpc/wsRpcClient.ts` for `terminal.onEvent` or `subscribeTerminalEvents`. Note its `(listener) => unsubscribe()` shape.

- [ ] **Step 2: Add the parallel subscriber**

Mirror the terminal subscribe pattern, e.g.:

```ts
detectedServers: {
  onEvent(
    threadId: string,
    listener: (event: DetectedServerEvent) => void,
  ): () => void {
    return subscribeStream("subscribeDetectedServerEvents", { threadId }, listener);
  },
  stop(serverId: string): Promise<DetectedServerStopResult> {
    return callRpc("detectedServers.stop", { serverId });
  },
  openInBrowser(serverId: string): Promise<{ ok: boolean }> {
    return callRpc("detectedServers.openInBrowser", { serverId });
  },
},
```

(Adapt names — `subscribeStream` / `callRpc` are placeholders for the real helpers in this file.)

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/rpc/wsRpcClient.ts
git commit -m "Add detectedServers subscription to WS RPC client"
```

---

## Phase 9 — Web UI

### Task 24: Build `DetectedServersBadge`

**Files:**

- Create: `apps/web/src/components/BranchToolbar/DetectedServersBadge.tsx`
- Create: `apps/web/src/components/BranchToolbar/DetectedServersBadge.test.tsx`
- Modify: `apps/web/src/components/BranchToolbar.tsx`

- [ ] **Step 1: Write the failing test**

Create `DetectedServersBadge.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetectedServersBadge } from "./DetectedServersBadge.tsx";
import type { DetectedServer } from "@ryco/contracts";

const make = (overrides: Partial<DetectedServer>): DetectedServer => ({
  id: "s",
  threadId: "t",
  source: "pty",
  framework: "vite",
  status: "live",
  startedAt: new Date(),
  lastSeenAt: new Date(),
  ...overrides,
});

describe("DetectedServersBadge", () => {
  it("renders nothing when no servers", () => {
    const { container } = render(<DetectedServersBadge servers={[]} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders count when 1+ servers", () => {
    render(<DetectedServersBadge servers={[make({})]} onClick={() => {}} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("applies pulsing class when any server is predicted or candidate", () => {
    const { container } = render(
      <DetectedServersBadge servers={[make({ status: "candidate" })]} onClick={() => {}} />,
    );
    expect(container.querySelector('[data-state="pulsing"]')).not.toBeNull();
  });

  it("no pulsing class when all servers are live", () => {
    const { container } = render(
      <DetectedServersBadge servers={[make({ status: "live" })]} onClick={() => {}} />,
    );
    expect(container.querySelector('[data-state="pulsing"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Implement the component**

Create `DetectedServersBadge.tsx`:

```tsx
import { Server } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";
import type { DetectedServer } from "@ryco/contracts";

interface Props {
  servers: DetectedServer[];
  onClick: () => void;
}

export const DetectedServersBadge = ({ servers, onClick }: Props) => {
  if (servers.length === 0) return null;
  const isPulsing = servers.some((s) => s.status === "predicted" || s.status === "candidate");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          data-state={isPulsing ? "pulsing" : "idle"}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-accent data-[state=pulsing]:animate-pulse"
        >
          <Server className="h-3.5 w-3.5" />
          <span className="tabular-nums">{servers.length}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5">
          {servers.map((s) => (
            <li key={s.id} className="text-xs">
              <span className="font-medium">{s.framework}</span>
              {s.url ? <span> · {s.url}</span> : null}
              <span className="ml-1 text-muted-foreground">· {s.status}</span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
};
```

- [ ] **Step 3: Slot the badge into `BranchToolbar`**

In `apps/web/src/components/BranchToolbar.tsx`:

```tsx
import { DetectedServersBadge } from "./BranchToolbar/DetectedServersBadge.tsx";
import { useDetectedServerStore } from "../detectedServerStore.ts";

// inside the component:
const servers = useDetectedServerStore((s) => {
  const m = s.serversByThreadKey[threadKey];
  return m ? [...m.values()] : [];
});

// in JSX, alongside the terminal toggle button:
<DetectedServersBadge servers={servers} onClick={openServersTab} />;
```

`openServersTab` is a callback the parent (`ChatView`) passes down that sets the drawer to open with the Servers kind active.

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test --filter @ryco/web -- DetectedServersBadge`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/BranchToolbar.tsx apps/web/src/components/BranchToolbar/
git commit -m "Add DetectedServersBadge to BranchToolbar"
```

---

### Task 25: Add kind tabset to `ThreadTerminalDrawer`

**Files:**

- Modify: `apps/web/src/components/ThreadTerminalDrawer.tsx`
- Modify: `apps/web/src/terminalStateStore.ts`

- [ ] **Step 1: Add `terminalDrawerKind` to the terminal state store**

In `apps/web/src/terminalStateStore.ts`, add per-thread field:

```ts
type DrawerKind = "terminals" | "servers";

// In the per-thread state shape:
terminalDrawerKind: DrawerKind; // default "terminals"

// In the action set:
setTerminalDrawerKind: (threadKey: string, kind: DrawerKind) => void;
```

Implement `setTerminalDrawerKind` to update the per-thread record and persist alongside drawer height. Include `terminalDrawerKind` in the localStorage serialization.

- [ ] **Step 2: Add kind tabs to the drawer**

In `ThreadTerminalDrawer.tsx`, above the current terminal-tab strip, render a small two-button toggle:

```tsx
<div className="flex items-center gap-1 border-b border-border px-2 py-1 text-xs">
  <button
    type="button"
    onClick={() => setTerminalDrawerKind(threadKey, "terminals")}
    aria-pressed={drawerKind === "terminals"}
    className={cn(
      "rounded px-2 py-0.5",
      drawerKind === "terminals"
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:text-foreground",
    )}
  >
    Terminals
  </button>
  <button
    type="button"
    onClick={() => setTerminalDrawerKind(threadKey, "servers")}
    aria-pressed={drawerKind === "servers"}
    className={cn(
      "rounded px-2 py-0.5",
      drawerKind === "servers"
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:text-foreground",
    )}
  >
    Servers
  </button>
</div>
```

- [ ] **Step 3: Render the right content based on `drawerKind`**

```tsx
{drawerKind === "terminals" ? (
  <ExistingTerminalContent ... />
) : (
  <DetectedServersPanel threadKey={threadKey} />
)}
```

`DetectedServersPanel` will be implemented in the next task. For now, stub it as `() => <div>Servers</div>` so the file compiles.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ThreadTerminalDrawer.tsx apps/web/src/terminalStateStore.ts
git commit -m "Add kind tabset (Terminals / Servers) to ThreadTerminalDrawer"
```

---

### Task 26: Build `DetectedServersPanel` + `DetectedServerRow`

**Files:**

- Create: `apps/web/src/components/detectedServers/DetectedServersPanel.tsx`
- Create: `apps/web/src/components/detectedServers/DetectedServerRow.tsx`

- [ ] **Step 1: Implement `DetectedServerRow`**

```tsx
import { Server, ExternalLink, Square, Copy } from "lucide-react";
import type { DetectedServer } from "@ryco/contracts";
import { Button } from "../ui/button.tsx";
import { cn } from "../../lib/utils.ts";

const STATUS_PILL_CLASS: Record<DetectedServer["status"], string> = {
  predicted: "bg-blue-500/20 text-blue-300",
  candidate: "bg-yellow-500/20 text-yellow-300 animate-pulse",
  confirmed: "bg-cyan-500/20 text-cyan-300",
  live: "bg-green-500/20 text-green-300",
  restarting: "bg-orange-500/20 text-orange-300 animate-pulse",
  exited: "bg-muted text-muted-foreground",
  crashed: "bg-red-500/20 text-red-300",
};

interface Props {
  server: DetectedServer;
  active: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onCopy: () => void;
  onStop: () => void;
}

export const DetectedServerRow = ({ server, active, onSelect, onOpen, onCopy, onStop }: Props) => (
  <button
    type="button"
    onClick={onSelect}
    className={cn(
      "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
      active && "bg-accent",
    )}
  >
    <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{server.framework}</span>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px]", STATUS_PILL_CLASS[server.status])}>
          {server.status}
        </span>
      </div>
      <div className="truncate text-muted-foreground">{server.url ?? "—"}</div>
    </div>
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
      {server.url && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title="Open in browser"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      )}
      {server.url && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          title="Copy URL"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={(e) => {
          e.stopPropagation();
          onStop();
        }}
        title="Stop"
        disabled={server.status === "exited" || server.status === "crashed"}
      >
        <Square className="h-3.5 w-3.5" />
      </Button>
    </div>
  </button>
);
```

- [ ] **Step 2: Implement `DetectedServersPanel`**

```tsx
import { useMemo } from "react";
import { useDetectedServerStore } from "../../detectedServerStore.ts";
import { DetectedServerRow } from "./DetectedServerRow.tsx";
import { DetectedServerLogView } from "./DetectedServerLogView.tsx";
import { rpcClient } from "../../rpc/wsRpcClient.ts";
import { toastManager } from "../../toastManager.ts";

interface Props {
  threadKey: string;
}

export const DetectedServersPanel = ({ threadKey }: Props) => {
  const serversMap = useDetectedServerStore((s) => s.serversByThreadKey[threadKey]);
  const activeId = useDetectedServerStore((s) => s.activeServerIdByThreadKey[threadKey] ?? null);
  const setActive = useDetectedServerStore((s) => s.setActive);

  const servers = useMemo(() => (serversMap ? [...serversMap.values()] : []), [serversMap]);
  const active = activeId && serversMap ? (serversMap.get(activeId) ?? null) : null;

  if (servers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        No servers detected yet. They'll appear here when an agent runs <code>dev</code>/
        <code>serve</code> commands.
      </div>
    );
  }

  const handleStop = async (serverId: string) => {
    const result = await rpcClient.detectedServers.stop(serverId);
    if (result.kind === "not-stoppable") {
      toastManager.show({
        title: "Server managed by agent",
        description: "Interrupt the current turn to stop it.",
      });
    }
  };

  const handleCopy = (url: string) => {
    void navigator.clipboard.writeText(url);
    toastManager.show({ title: "Copied", description: url });
  };

  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-border p-1">
        {servers.map((s) => (
          <DetectedServerRow
            key={s.id}
            server={s}
            active={s.id === activeId}
            onSelect={() => setActive(threadKey, s.id)}
            onOpen={() => void rpcClient.detectedServers.openInBrowser(s.id)}
            onCopy={() => s.url && handleCopy(s.url)}
            onStop={() => void handleStop(s.id)}
          />
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {active ? (
          <DetectedServerLogView serverId={active.id} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Select a server to view logs
          </div>
        )}
      </div>
    </div>
  );
};
```

Replace the `DetectedServersPanel` stub created in Task 25 with this real export. Note: `DetectedServerLogView` is built in the next task; for now temporarily stub it as `() => <div>logs</div>` inline at the import site if needed to keep the build green.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: no errors. (Stub `DetectedServerLogView` import temporarily if necessary.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/detectedServers/
git commit -m "Add DetectedServersPanel and DetectedServerRow"
```

---

### Task 27: Build `DetectedServerLogView` with xterm.js

**Files:**

- Create: `apps/web/src/components/detectedServers/DetectedServerLogView.tsx`

- [ ] **Step 1: Inspect the existing xterm.js mount pattern**

Open `apps/web/src/components/ThreadTerminalDrawer.tsx`. Find where `new Terminal()` is constructed and `.open(element)` is called. Note: how `FitAddon` is attached, how `dispose()` is called on unmount, and how new data is `.write(data)`-ed to the terminal.

- [ ] **Step 2: Implement the log view**

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useDetectedServerStore } from "../../detectedServerStore.ts";

interface Props {
  serverId: string;
}

export const DetectedServerLogView = ({ serverId }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenLengthRef = useRef(0);

  const buffer = useDetectedServerStore((s) => s.logBuffersByServerId.get(serverId));

  // Mount once
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      theme: { background: "transparent" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    writtenLengthRef.current = 0;
    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Replay/incremental write on buffer change
  useEffect(() => {
    if (!termRef.current || !buffer) return;
    const snap = buffer.snapshot();
    if (writtenLengthRef.current > snap.length) {
      // Buffer was trimmed from head — re-render from scratch
      termRef.current.clear();
      writtenLengthRef.current = 0;
    }
    for (let i = writtenLengthRef.current; i < snap.length; i += 1) {
      termRef.current.writeln(snap[i]!);
    }
    writtenLengthRef.current = snap.length;
  }, [buffer, buffer?.snapshot().length]);

  // Resize on container resize
  useEffect(() => {
    const handler = () => fitRef.current?.fit();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Reset on serverId change
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.clear();
    writtenLengthRef.current = 0;
  }, [serverId]);

  return <div ref={containerRef} className="h-full w-full p-2" />;
};
```

- [ ] **Step 3: Replace stub in `DetectedServersPanel`**

If a temporary stub was added in Task 26, swap it for the real import.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/detectedServers/DetectedServerLogView.tsx
git commit -m "Add xterm.js-backed log view for detected servers"
```

---

### Task 28: Wire WS subscription in ChatView

**Files:**

- Modify: `apps/web/src/components/ChatView.tsx` (or wherever active-thread WS subscriptions live)

- [ ] **Step 1: Inspect the existing terminal subscription site**

Search for `terminal.onEvent` in `apps/web/src/components/`. The detected-servers subscription belongs next to it, scoped to the same thread-active lifecycle.

- [ ] **Step 2: Add the subscription**

```tsx
import { useEffect } from "react";
import { rpcClient } from "../rpc/wsRpcClient.ts";
import { useDetectedServerStore } from "../detectedServerStore.ts";

// Inside the component, where threadId is available:
useEffect(() => {
  if (!threadId) return;
  const handle = (event: DetectedServerEvent) => {
    useDetectedServerStore.getState().handleEvent(threadId, event);
  };
  return rpcClient.detectedServers.onEvent(threadId, handle);
}, [threadId]);
```

- [ ] **Step 3: Wire `openServersTab` callback to `BranchToolbar`**

Make `ChatView` pass a `onOpenServersTab` callback that calls:

```ts
useTerminalStateStore.getState().setTerminalOpen(threadKey, true);
useTerminalStateStore.getState().setTerminalDrawerKind(threadKey, "servers");
```

`BranchToolbar` passes this through to `DetectedServersBadge` as `onClick`.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the dev server and manually verify**

Run: `bun run dev:web` (and `bun run dev:server` if separate)

Manually:

1. Open the web app.
2. Open a thread.
3. From the integrated terminal, run `npx vite` in a real Vite project, or use the agent to spawn a dev server.
4. Verify the badge appears in `BranchToolbar` with count `1` and pulses while `predicted`/`candidate`.
5. Click the badge → drawer opens with Servers tab active.
6. Confirm the server row shows framework=`vite`, status pill cycles to `live`, URL is clickable.
7. Click the URL → browser opens.
8. Click stop → server exits, status → `exited`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ChatView.tsx apps/web/src/components/BranchToolbar.tsx
git commit -m "Subscribe to detectedServers events and wire badge → drawer tab transition"
```

---

## Phase 10 — Final gate

### Task 29: Run the full quality gate

**Files:** none.

- [ ] **Step 1: Format**

Run: `bun fmt`
Expected: no diff.

- [ ] **Step 2: Lint**

Run: `bun lint`
Expected: no warnings or errors.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors across the entire monorepo.

- [ ] **Step 4: Test**

Run: `bun run test`
Expected: all tests PASS (including new unit, OS adapter, and integration tests).

- [ ] **Step 5: Smoke test manually**

Repeat the manual smoke test from Task 28 Step 5 against the agent flow:

1. Open a Codex thread.
2. Approve a `bun run dev` (or `npm run dev`) command in a project whose `package.json` `scripts.dev` is `vite`.
3. Confirm a `candidate` server appears in the Servers tab with the agent's printed URL.
4. Confirm status remains `candidate` (does not progress to `live` — by design for agent-internal).
5. Confirm clicking the URL opens the browser.

- [ ] **Step 6: Final commit (if any cleanup)**

If `bun fmt` produced changes, commit them. Otherwise no commit.

```bash
git status
# if any modified files:
git add -A
git commit -m "Format and lint cleanup"
```

---

## Notes for the engineer

- **Effect 4.0 Service patterns**: this codebase uses `Context.Service<Tag, Shape>()("namespace/Tag")` for service tags (see `apps/server/src/terminal/Services/PTY.ts:56-58`). Match that style. The newer `Effect.Service.builder` syntax is also accepted but not yet pervasive — prefer matching the file you're editing.
- **Schema check chaining**: the codebase uses `.check(Schema.isPattern(...))`, `.check(Schema.isMaxLength(...))`, etc., rather than `.pipe(Schema.filter(...))`. Match that style (see `packages/contracts/src/terminal.ts:13-16`).
- **WS push channel**: the existing `terminal.event` channel is the closest pattern. Search for it in `packages/contracts/src/ws.ts` and `apps/server/src/wsServer.ts` and mirror the wiring exactly.
- **AGENTS.md hard rules**: `bun run test`, never `bun test`. `bun fmt`, `bun lint`, `bun run typecheck` must pass before each commit.
- **Commit messages**: this codebase does not use Conventional Commits prefixes; one-line imperative summary is the norm (see `git log -10 --oneline`).
- **No Co-Authored-By trailers** in commit messages (per user preference).

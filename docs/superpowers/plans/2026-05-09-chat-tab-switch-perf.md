# Chat Session Tab Switch Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut perceived latency from clicking a session tab in the chat header to the new thread's content rendering, targeting <100ms on a typical PR with 50 messages.

**Architecture:** Three-pronged approach. (1) Add measurement instrumentation so we can verify before/after numbers without speculation. (2) Warm the WebSocket thread-detail subscription on tab hover/focus so data is hot when click occurs (eliminates network/WS latency from the critical path). (3) Replace the broad `selectSidebarThreadsForProjectRef` + `useShallow` chain that drives the tab strip with a targeted selector that returns pre-derived `ChatSessionTabsItem[]` and only re-derives when tab-shape inputs change (id/title/archivedAt/manualBucket/statusBucket) — not when activity-only fields update. Defer the larger ChatView decomposition (item 1 in the spec) to a follow-up; the file is 4052 lines and a partial refactor would create risk without delivering the headline latency win.

**Tech Stack:** React 19, zustand 5 with `useShallow`, TanStack Router v1, TanStack Query v5, Vitest. The existing `retainThreadDetailSubscription(env, threadId)` primitive in `apps/web/src/environments/runtime/service.ts` is the actual prefetch tool — `router.preloadRoute(...)` is belt-and-braces because the `_chat.$environmentId.$threadId` route has no loader; data flows through the WebSocket store.

**Out of scope:**

- Full ChatView decomposition (4052 lines, multi-PR effort)
- Sidebar changes (reference only)
- PR/Issue dialog work in `apps/web/src/components/projectExplorer`
- The pre-existing failing test `ProjectionSnapshotQuery.test.ts`

**Measurement caveat:** The agent cannot capture DevTools Performance profiles directly. We add `Performance.mark`/`measure` instrumentation that the user can read via the browser console (`performance.getEntriesByType("measure")`) and we add a dev-only render counter. The user is responsible for clicking tabs and reporting numbers; the agent applies fixes that are well-evidenced from code review and verifies test suites.

---

## File Structure

**New files:**

- `apps/web/src/perf/tabSwitchInstrumentation.ts` — `Performance.mark`/`measure` helpers for tab-click → first-paint timing, plus a dev-only render-counter hook.
- `apps/web/src/perf/tabSwitchInstrumentation.test.ts` — unit tests for the timing helper (pure logic, no DOM).
- `apps/web/src/sessionTabs.selectors.ts` — targeted selector that returns `ChatSessionTabsItem[]` with reference-stable item caching.
- `apps/web/src/sessionTabs.selectors.test.ts` — selector behavior tests (reference stability, filtering, sorting).
- `apps/web/src/components/chat/ChatSessionTabsPrefetch.ts` — pure controller for the hover/focus prefetch lifecycle (debounced retain/release). Tested in isolation.
- `apps/web/src/components/chat/ChatSessionTabsPrefetch.test.ts` — controller tests with fake timers.

**Modified files:**

- `apps/web/src/components/chat/ChatSessionTabs.tsx` — wire `onPointerEnter`/`onFocus`/`onPointerLeave`/`onBlur` to a new `onPrefetch?: (key: string) => () => void` prop.
- `apps/web/src/components/ChatView.tsx` — switch from broad selector to `selectActiveWorktreeSessionTabs(...)`; add prefetch handler that returns disposers; instrument tab-click + first-paint marks.
- `apps/web/src/components/chat/ChatHeader.tsx` — optional render counter wiring (gated by `import.meta.env.DEV`).

---

## Task 1: Add measurement helpers

**Files:**

- Create: `apps/web/src/perf/tabSwitchInstrumentation.ts`
- Test: `apps/web/src/perf/tabSwitchInstrumentation.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/perf/tabSwitchInstrumentation.test.ts
import { describe, expect, it } from "vitest";
import { TAB_SWITCH_MARK_PREFIX, makeTabSwitchMarkName } from "./tabSwitchInstrumentation";

describe("makeTabSwitchMarkName", () => {
  it("encodes phase and key", () => {
    expect(makeTabSwitchMarkName("click", "env:thr_1")).toBe(
      `${TAB_SWITCH_MARK_PREFIX}click:env:thr_1`,
    );
    expect(makeTabSwitchMarkName("first-paint", "env:thr_1")).toBe(
      `${TAB_SWITCH_MARK_PREFIX}first-paint:env:thr_1`,
    );
  });

  it("rejects unsafe keys (no colons in key suffix)", () => {
    expect(() => makeTabSwitchMarkName("click", "")).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `bun run test apps/web/src/perf/tabSwitchInstrumentation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper**

```typescript
// apps/web/src/perf/tabSwitchInstrumentation.ts
import { useEffect, useRef } from "react";

export const TAB_SWITCH_MARK_PREFIX = "ryco:tab-switch:";

export type TabSwitchPhase = "click" | "first-paint";

export function makeTabSwitchMarkName(phase: TabSwitchPhase, key: string): string {
  if (!key) {
    throw new Error("tab-switch mark name requires a non-empty key");
  }
  return `${TAB_SWITCH_MARK_PREFIX}${phase}:${key}`;
}

export function markTabSwitchClick(key: string): void {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  performance.mark(makeTabSwitchMarkName("click", key));
}

export function markTabSwitchFirstPaint(key: string): void {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  const name = makeTabSwitchMarkName("first-paint", key);
  // Avoid duplicate marks for the same key — only the first commit after the click counts.
  if (performance.getEntriesByName(name).length > 0) return;
  performance.mark(name);
  try {
    performance.measure(`ryco:tab-switch:${key}`, makeTabSwitchMarkName("click", key), name);
  } catch {
    // No matching click mark — ignore. Happens for the initial route mount.
  }
}

/**
 * Dev-only render counter. Logs `[render] <label> #N` to the console on each render.
 * Use to verify a memo'd subtree is not re-rendering when it shouldn't.
 */
export function useRenderCounter(label: string): void {
  const count = useRef(0);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    count.current += 1;
    // eslint-disable-next-line no-console
    console.debug(`[render] ${label} #${count.current}`);
  });
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `bun run test apps/web/src/perf/tabSwitchInstrumentation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/perf/tabSwitchInstrumentation.ts apps/web/src/perf/tabSwitchInstrumentation.test.ts
git commit -m "Add Performance.mark helpers for tab-switch timing"
```

---

## Task 2: Pure prefetch controller

**Files:**

- Create: `apps/web/src/components/chat/ChatSessionTabsPrefetch.ts`
- Test: `apps/web/src/components/chat/ChatSessionTabsPrefetch.test.ts`

The controller wraps "retain a subscription on hover, release N ms after pointer-leave (so quick mouse movement doesn't churn)" without coupling the test to React or to the actual subscription module. The retain function is injected; the test passes a stub.

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/components/chat/ChatSessionTabsPrefetch.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTabPrefetchController } from "./ChatSessionTabsPrefetch";

describe("createTabPrefetchController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retains exactly once per key while pointer is over", () => {
    const release = vi.fn();
    const retain = vi.fn(() => release);
    const controller = createTabPrefetchController({ retain, releaseDelayMs: 250 });

    controller.enter("k1");
    controller.enter("k1");
    expect(retain).toHaveBeenCalledTimes(1);

    controller.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases after delay on leave, but cancels release if re-entered", () => {
    const release = vi.fn();
    const retain = vi.fn(() => release);
    const controller = createTabPrefetchController({ retain, releaseDelayMs: 250 });

    controller.enter("k1");
    controller.leave("k1");
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    controller.enter("k1"); // re-enter cancels the pending release
    vi.advanceTimersByTime(500);
    expect(release).not.toHaveBeenCalled();

    controller.leave("k1");
    vi.advanceTimersByTime(250);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("retains independently per key", () => {
    const releases: Record<string, () => void> = {};
    const retain = vi.fn((key: string) => {
      const fn = vi.fn();
      releases[key] = fn;
      return fn;
    });
    const controller = createTabPrefetchController({ retain, releaseDelayMs: 250 });

    controller.enter("a");
    controller.enter("b");
    expect(retain).toHaveBeenCalledTimes(2);

    controller.leave("a");
    vi.advanceTimersByTime(250);
    expect(releases.a).toHaveBeenCalledTimes(1);
    expect(releases.b).not.toHaveBeenCalled();

    controller.dispose();
    expect(releases.b).toHaveBeenCalledTimes(1);
  });

  it("noops on leave for unknown keys", () => {
    const retain = vi.fn(() => vi.fn());
    const controller = createTabPrefetchController({ retain, releaseDelayMs: 250 });
    expect(() => controller.leave("never-entered")).not.toThrow();
    expect(retain).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `bun run test apps/web/src/components/chat/ChatSessionTabsPrefetch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement controller**

```typescript
// apps/web/src/components/chat/ChatSessionTabsPrefetch.ts
export interface TabPrefetchControllerInput {
  retain: (key: string) => () => void;
  releaseDelayMs: number;
}

interface Entry {
  release: () => void;
  pendingReleaseTimer: ReturnType<typeof setTimeout> | null;
}

export interface TabPrefetchController {
  enter: (key: string) => void;
  leave: (key: string) => void;
  dispose: () => void;
}

export function createTabPrefetchController(
  input: TabPrefetchControllerInput,
): TabPrefetchController {
  const entries = new Map<string, Entry>();

  function clearPendingRelease(entry: Entry): void {
    if (entry.pendingReleaseTimer !== null) {
      clearTimeout(entry.pendingReleaseTimer);
      entry.pendingReleaseTimer = null;
    }
  }

  return {
    enter: (key) => {
      const existing = entries.get(key);
      if (existing) {
        clearPendingRelease(existing);
        return;
      }
      const release = input.retain(key);
      entries.set(key, { release, pendingReleaseTimer: null });
    },
    leave: (key) => {
      const entry = entries.get(key);
      if (!entry) return;
      clearPendingRelease(entry);
      entry.pendingReleaseTimer = setTimeout(() => {
        entry.release();
        entries.delete(key);
      }, input.releaseDelayMs);
    },
    dispose: () => {
      for (const entry of entries.values()) {
        clearPendingRelease(entry);
        entry.release();
      }
      entries.clear();
    },
  };
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `bun run test apps/web/src/components/chat/ChatSessionTabsPrefetch.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/chat/ChatSessionTabsPrefetch.ts apps/web/src/components/chat/ChatSessionTabsPrefetch.test.ts
git commit -m "Add tab-prefetch controller with debounced retain/release"
```

---

## Task 3: Wire prefetch into ChatSessionTabs

**Files:**

- Modify: `apps/web/src/components/chat/ChatSessionTabs.tsx`

- [ ] **Step 1: Extend props**

Edit `apps/web/src/components/chat/ChatSessionTabs.tsx`:

Old:

```tsx
export interface ChatSessionTabsProps {
  items: ReadonlyArray<ChatSessionTabsItem>;
  activeKey: string | null;
  onSelect: (key: string) => void;
  onNew?: (() => void) | undefined;
}
```

New:

```tsx
export interface ChatSessionTabsProps {
  items: ReadonlyArray<ChatSessionTabsItem>;
  activeKey: string | null;
  onSelect: (key: string) => void;
  onPrefetchEnter?: ((key: string) => void) | undefined;
  onPrefetchLeave?: ((key: string) => void) | undefined;
  onNew?: (() => void) | undefined;
}
```

- [ ] **Step 2: Wire handlers in the button**

Inside the `<button>` element, add `onPointerEnter`, `onFocus`, `onPointerLeave`, `onBlur`. Skip prefetch for the active tab — there's nothing to warm.

```tsx
<button
  key={item.key}
  type="button"
  role="tab"
  aria-selected={isActive}
  data-session-tab-key={item.key}
  onClick={() => props.onSelect(item.key)}
  onPointerEnter={
    !isActive && props.onPrefetchEnter
      ? () => props.onPrefetchEnter?.(item.key)
      : undefined
  }
  onFocus={
    !isActive && props.onPrefetchEnter
      ? () => props.onPrefetchEnter?.(item.key)
      : undefined
  }
  onPointerLeave={
    !isActive && props.onPrefetchLeave
      ? () => props.onPrefetchLeave?.(item.key)
      : undefined
  }
  onBlur={
    !isActive && props.onPrefetchLeave
      ? () => props.onPrefetchLeave?.(item.key)
      : undefined
  }
  className={...}
  title={item.title}
>
```

- [ ] **Step 3: Verify formatter & types**

Run: `bun fmt && bun typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chat/ChatSessionTabs.tsx
git commit -m "Add prefetch enter/leave hooks to ChatSessionTabs"
```

---

## Task 4: Targeted selector for session tab items

**Files:**

- Create: `apps/web/src/sessionTabs.selectors.ts`
- Test: `apps/web/src/sessionTabs.selectors.test.ts`

This selector replaces the chain `useShallow(selectSidebarThreadsForProjectRef) → useMemo(filter+sort+map)` in ChatView. It does the filter/sort/derive in the selector, caches per-thread item references so that updating a non-tab field in a thread summary doesn't change item identity, and returns a fresh top-level array only when the tab list shape changes.

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/sessionTabs.selectors.test.ts
import { describe, expect, it } from "vitest";
import { createSessionTabsSelector } from "./sessionTabs.selectors";
import type { SidebarThreadSummary } from "./types";

function makeThread(overrides: Partial<SidebarThreadSummary>): SidebarThreadSummary {
  return {
    id: "t-1" as SidebarThreadSummary["id"],
    environmentId: "env-1" as SidebarThreadSummary["environmentId"],
    projectId: "p-1" as SidebarThreadSummary["projectId"],
    title: "Thread",
    interactionMode: "chat",
    session: null,
    createdAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
    updatedAt: "2026-01-01T00:00:00Z",
    latestTurn: null,
    branch: "main",
    worktreePath: "/tmp/wt",
    worktreeId: "wt-1",
    manualStatusBucket: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as SidebarThreadSummary;
}

describe("createSessionTabsSelector", () => {
  it("filters by worktreeId, hides archived, sorts by updatedAt desc", () => {
    const select = createSessionTabsSelector();
    const threads: SidebarThreadSummary[] = [
      makeThread({ id: "a" as never, worktreeId: "wt-1", updatedAt: "2026-01-02T00:00:00Z" }),
      makeThread({ id: "b" as never, worktreeId: "wt-2", updatedAt: "2026-01-03T00:00:00Z" }),
      makeThread({ id: "c" as never, worktreeId: "wt-1", updatedAt: "2026-01-01T00:00:00Z" }),
      makeThread({
        id: "d" as never,
        worktreeId: "wt-1",
        archivedAt: "2026-01-04T00:00:00Z",
      }),
    ];
    const result = select(threads, { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    expect(result.map((item) => item.key.split(":").at(-1))).toEqual(["a", "c"]);
  });

  it("returns the same array reference when inputs are unchanged", () => {
    const select = createSessionTabsSelector();
    const threads = [makeThread({ id: "a" as never })];
    const r1 = select(threads, { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    const r2 = select(threads, { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    expect(r2).toBe(r1);
  });

  it("returns same item references when only non-tab fields change", () => {
    const select = createSessionTabsSelector();
    const t1 = makeThread({ id: "a" as never, latestUserMessageAt: null });
    const r1 = select([t1], { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    const t1Updated = { ...t1, latestUserMessageAt: "2026-01-02T00:00:00Z" };
    const r2 = select([t1Updated], { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    expect(r2[0]).toBe(r1[0]);
  });

  it("returns a new item reference when the bucket flips", () => {
    const select = createSessionTabsSelector();
    const idle = makeThread({ id: "a" as never });
    const working = {
      ...idle,
      session: { status: "running" } as SidebarThreadSummary["session"],
    };
    const r1 = select([idle], { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    const r2 = select([working], { worktreeId: "wt-1", worktreePath: "/tmp/wt" });
    expect(r1[0].bucket).toBe("idle");
    expect(r2[0].bucket).toBe("in_progress");
    expect(r2[0]).not.toBe(r1[0]);
  });

  it("matches by worktreePath when worktreeId is missing on the thread", () => {
    const select = createSessionTabsSelector();
    const threads = [
      makeThread({ id: "x" as never, worktreeId: undefined, worktreePath: "/tmp/match" }),
      makeThread({ id: "y" as never, worktreeId: undefined, worktreePath: "/tmp/other" }),
    ];
    const result = select(threads, { worktreeId: "wt-1", worktreePath: "/tmp/match" });
    expect(result.map((item) => item.key.split(":").at(-1))).toEqual(["x"]);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `bun run test apps/web/src/sessionTabs.selectors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement selector**

```typescript
// apps/web/src/sessionTabs.selectors.ts
import { scopeThreadRef, scopedThreadKey } from "@ryco/client-runtime";
import type { ChatSessionTabsItem } from "./components/chat/ChatSessionTabs";
import { deriveStatusBucket, resolveThreadStatusPill } from "./components/Sidebar.logic";
import type { SidebarStatusBucket } from "./components/Sidebar.logic";
import type { SidebarThreadSummary } from "./types";

export interface SessionTabsFilter {
  worktreeId: string | null | undefined;
  worktreePath: string | null | undefined;
}

interface CachedItem {
  item: ChatSessionTabsItem;
  inputs: {
    title: string;
    bucket: SidebarStatusBucket;
  };
}

/**
 * Create a stateful selector that derives ChatSessionTabsItem[] from a
 * SidebarThreadSummary[] + filter. Caches per-thread items so unchanged
 * threads keep the same item reference, and returns the same array
 * reference when the visible set + per-item shape are unchanged.
 *
 * Caller is expected to memoize the selector instance per consumer (e.g.
 * via useMemo) so the cache survives across renders.
 */
export function createSessionTabsSelector(): (
  threads: ReadonlyArray<SidebarThreadSummary>,
  filter: SessionTabsFilter,
) => ReadonlyArray<ChatSessionTabsItem> {
  const cache = new Map<string, CachedItem>();
  let lastResult: ReadonlyArray<ChatSessionTabsItem> | null = null;

  return (threads, filter) => {
    const matching: SidebarThreadSummary[] = [];
    for (const thread of threads) {
      if (thread.archivedAt !== null) continue;
      if (thread.worktreeId !== undefined && thread.worktreeId !== null && filter.worktreeId) {
        if (thread.worktreeId !== filter.worktreeId) continue;
      } else if (filter.worktreePath) {
        if (thread.worktreePath !== filter.worktreePath) continue;
      } else {
        continue;
      }
      matching.push(thread);
    }
    matching.sort(
      (a, b) =>
        (Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0) -
        (Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0),
    );

    const seenKeys = new Set<string>();
    const items: ChatSessionTabsItem[] = [];
    let identical = lastResult !== null && lastResult.length === matching.length;
    for (let i = 0; i < matching.length; i += 1) {
      const thread = matching[i]!;
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      seenKeys.add(key);
      const bucket = deriveStatusBucket({
        manualBucket: thread.manualStatusBucket ?? null,
        statusPill: resolveThreadStatusPill({ thread }),
      });
      const cached = cache.get(key);
      let item: ChatSessionTabsItem;
      if (cached && cached.inputs.title === thread.title && cached.inputs.bucket === bucket) {
        item = cached.item;
      } else {
        item = { key, title: thread.title, bucket };
        cache.set(key, { item, inputs: { title: thread.title, bucket } });
      }
      items.push(item);
      if (identical && lastResult![i] !== item) identical = false;
    }

    for (const key of cache.keys()) {
      if (!seenKeys.has(key)) cache.delete(key);
    }

    if (identical && lastResult) return lastResult;
    lastResult = items;
    return items;
  };
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `bun run test apps/web/src/sessionTabs.selectors.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/sessionTabs.selectors.ts apps/web/src/sessionTabs.selectors.test.ts
git commit -m "Add reference-stable session tabs selector"
```

---

## Task 5: Wire targeted selector + prefetch into ChatView

**Files:**

- Modify: `apps/web/src/components/ChatView.tsx`

- [ ] **Step 1: Replace activeWorktreeSessionTabs derivation**

Locate `apps/web/src/components/ChatView.tsx:912-940` (the `activeWorktreeSessionTabs` `useMemo`). Replace the chain `useStore(useShallow(selectSidebarThreadsForProjectRef)) → useMemo(filter+sort+map)` with a single subscription that runs the targeted selector inside the store.

Add imports near the existing selector imports (around line 89):

```tsx
import { createSessionTabsSelector } from "../sessionTabs.selectors";
```

Replace the `projectSidebarThreads` + `activeWorktreeSessionTabs` block:

Old (lines ~883-940):

```tsx
const projectSidebarThreads = useStore(
  useShallow((state) =>
    activeProjectRef ? selectSidebarThreadsForProjectRef(state, activeProjectRef) : [],
  ),
);
// ... activeWorktreeSummary block stays ...
const tabsWorktreeId = activeThread?.worktreeId;
const tabsWorktreePath = activeThread?.worktreePath;
const activeWorktreeSessionTabs = useMemo<ChatSessionTabsItem[]>(() => {
  // ... full filter/sort/map ...
}, [tabsWorktreeId, tabsWorktreePath, projectSidebarThreads]);
```

New:

```tsx
const sessionTabsSelector = useMemo(() => createSessionTabsSelector(), []);
const tabsWorktreeId = activeThread?.worktreeId;
const tabsWorktreePath = activeThread?.worktreePath;
const activeWorktreeSessionTabs = useStore((state) => {
  if (!activeProjectRef) return EMPTY_SESSION_TABS;
  if (tabsWorktreeId === undefined && tabsWorktreePath === undefined) {
    return EMPTY_SESSION_TABS;
  }
  const threads = selectSidebarThreadsForProjectRef(state, activeProjectRef);
  return sessionTabsSelector(threads, {
    worktreeId: tabsWorktreeId ?? null,
    worktreePath: tabsWorktreePath ?? null,
  });
});
```

Keep `projectSidebarThreads` only if it's used elsewhere — currently it's also used by `projectSidebarThreadsRef` for `handleSelectSessionTab`. To preserve that, narrow the ref to a list of `(key, environmentId, id)` triples derived from the same selector via a sibling cache, or fall back to a minimal lookup. Easier: rebuild `projectSidebarThreadsRef` from the existing untargeted selector but only for the click handler, or thread the items themselves into the click handler.

Cleaner replacement for the click handler — the tabs already carry `key`, and tabs include enough info to recover env/threadId. Switch to deriving env/threadId by parsing the key (the key is built from `scopeThreadRef(envId, threadId)` + `scopedThreadKey`). Look up via store directly:

```tsx
const handleSelectSessionTab = useCallback(
  (key: string) => {
    void (async () => {
      const target = activeWorktreeSessionTabs.find((item) => item.key === key);
      if (!target) return;
      // The store has scopedThreadKey -> ref encoding utilities; reuse them.
      const ref = parseScopedThreadKey(key); // see helper below
      if (!ref) return;
      markTabSwitchClick(key);
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: ref.environmentId, threadId: ref.threadId },
      });
    })();
  },
  [activeWorktreeSessionTabs, navigate],
);
```

If a `parseScopedThreadKey` helper does not already exist in `@ryco/client-runtime`, keep using `projectSidebarThreadsRef.current.find(...)` — that ref is fed by the existing untargeted selector and is still cheap.

Add at the top of the file (next to other `EMPTY_*` constants):

```tsx
const EMPTY_SESSION_TABS: ReadonlyArray<ChatSessionTabsItem> = Object.freeze([]);
```

- [ ] **Step 2: Add prefetch wiring**

Above the `handleSelectSessionTab` definition, add:

```tsx
import { createTabPrefetchController } from "./chat/ChatSessionTabsPrefetch";
import { retainThreadDetailSubscription } from "../environments/runtime/service";
import { markTabSwitchClick } from "../perf/tabSwitchInstrumentation";

// ...inside ChatView body...
const prefetchControllerRef = useRef<ReturnType<typeof createTabPrefetchController> | null>(null);
useEffect(() => {
  const controller = createTabPrefetchController({
    retain: (key) => {
      const target = projectSidebarThreadsRef.current.find(
        (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === key,
      );
      if (!target) return () => {};
      return retainThreadDetailSubscription(target.environmentId, target.id);
    },
    releaseDelayMs: 250,
  });
  prefetchControllerRef.current = controller;
  return () => {
    controller.dispose();
    prefetchControllerRef.current = null;
  };
}, []);

const handleTabPrefetchEnter = useCallback(
  (key: string) => prefetchControllerRef.current?.enter(key),
  [],
);
const handleTabPrefetchLeave = useCallback(
  (key: string) => prefetchControllerRef.current?.leave(key),
  [],
);
```

`retainThreadDetailSubscription` is already imported in ChatView at line 200. Reuse it.

- [ ] **Step 3: Pass new handlers + first-paint mark**

In the `<ChatHeader>` JSX block (around line 3770), pass:

```tsx
onSelectSessionTab = { handleSelectSessionTab };
onPrefetchTabEnter = { handleTabPrefetchEnter };
onPrefetchTabLeave = { handleTabPrefetchLeave };
```

Add the new optional props to `ChatHeader.tsx` (`apps/web/src/components/chat/ChatHeader.tsx`):

```tsx
onPrefetchTabEnter?: (key: string) => void;
onPrefetchTabLeave?: (key: string) => void;
```

In ChatHeader's JSX, forward them to `<ChatSessionTabs>`:

```tsx
{
  showTabs && props.onSelectSessionTab ? (
    <ChatSessionTabs
      items={tabs}
      activeKey={props.activeSessionTabKey ?? null}
      onSelect={props.onSelectSessionTab}
      {...(props.onPrefetchTabEnter ? { onPrefetchEnter: props.onPrefetchTabEnter } : {})}
      {...(props.onPrefetchTabLeave ? { onPrefetchLeave: props.onPrefetchTabLeave } : {})}
      {...(props.onNewSessionInWorktree ? { onNew: props.onNewSessionInWorktree } : {})}
    />
  ) : null;
}
```

Add the first-paint mark in ChatView. The ChatView body renders `<MessagesTimeline>` — wrap that with an effect that fires on the first render for a given threadKey:

```tsx
const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
useEffect(() => {
  if (!activeThreadKey) return;
  // Schedule a microtask so the mark lands AFTER React commits the new tree.
  queueMicrotask(() => markTabSwitchFirstPaint(activeThreadKey));
}, [activeThreadKey]);
```

(`activeThreadKey` already exists at line 841; reuse it.)

- [ ] **Step 4: Verify formatter & types**

Run: `bun fmt && bun lint && bun typecheck`
Expected: PASS.

- [ ] **Step 5: Run unit tests**

Run: `bun run test`
Expected: All previously passing tests still pass. The pre-existing `ProjectionSnapshotQuery.test.ts` failure may remain — leave it. Note the count of pass/fail and confirm no new failures.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ChatView.tsx apps/web/src/components/chat/ChatHeader.tsx
git commit -m "Wire targeted selector and hover prefetch into ChatView session tabs"
```

---

## Task 6: ChatHeader render audit (verify, fix if needed)

**Files:**

- Modify: `apps/web/src/components/chat/ChatHeader.tsx` (temporary instrumentation)
- Modify: `apps/web/src/components/ChatView.tsx` (memo equality on activeWorktreeSummary if it leaks)

This task is conditional on what the user observes. The expected result is "ChatHeader renders 1× per tab click and zero times during streaming." If the counter shows otherwise, fix the broken prop.

- [ ] **Step 1: Add render counter (temporary)**

In `apps/web/src/components/chat/ChatHeader.tsx`, near the top of the `ChatHeader` body:

```tsx
import { useRenderCounter } from "../../perf/tabSwitchInstrumentation";
// ...
useRenderCounter("ChatHeader");
```

Also instrument `MessagesTimeline` to verify it's the one re-rendering during streaming (expected). Add `useRenderCounter("MessagesTimeline")` at the top of `apps/web/src/components/chat/MessagesTimeline.tsx`'s body.

- [ ] **Step 2: Have user verify and report**

Run dev server: `bun dev` (apps/web).
User instructions:

1. Open DevTools console.
2. Filter for `[render]`.
3. Click a tab → expect ChatHeader to render once. Note the count.
4. Wait 5s while a thread is streaming → ChatHeader should NOT render. MessagesTimeline should.
5. Report counts.

If ChatHeader re-renders during streaming, check:

- `activeWorktreeSummary` selector — it returns a fresh ref on every state change because the inline closure isn't memoized properly. Look at `apps/web/src/components/ChatView.tsx:888-908`. Switch the inline factory to `useShallow` over the fields actually consumed (branch, title, origin), or split into three flat selectors.
- `sessionTabs` array — should be stable from the new selector. Verify with `Object.is(prevTabs, currTabs)` log in ChatHeader if needed.

Likely fix for `activeWorktreeSummary` (apply only if needed):

```tsx
const activeWorktreeBranch = useStore((state) => {
  if (!activeThread?.environmentId || !activeThread.worktreeId) return null;
  return (
    state.environmentStateById[activeThread.environmentId]?.worktreeById?.[activeThread.worktreeId]
      ?.branch ?? null
  );
});
const activeWorktreeTitle = useStore((state) => {
  if (!activeThread?.environmentId || !activeThread.worktreeId) return null;
  return (
    state.environmentStateById[activeThread.environmentId]?.worktreeById?.[activeThread.worktreeId]
      ?.title ?? null
  );
});
const activeWorktreeOrigin = useStore((state) => {
  if (!activeThread?.environmentId || !activeThread.worktreeId) return null;
  return (
    state.environmentStateById[activeThread.environmentId]?.worktreeById?.[activeThread.worktreeId]
      ?.origin ?? null
  );
});
```

And replace `activeWorktreeSummary?.branch` etc with these flat values in the JSX that passes props to `<ChatHeader>`.

- [ ] **Step 3: Remove render counters before commit**

After the user has confirmed (or fixed) the render behavior, remove the `useRenderCounter` calls. The instrumentation library remains — it's useful for future debugging.

- [ ] **Step 4: Verify formatter & types**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: PASS.

- [ ] **Step 5: Commit (only if a fix was needed)**

```bash
git add apps/web/src/components/ChatView.tsx
git commit -m "Stabilize active-worktree subscriptions in ChatView header props"
```

---

## Task 7: Pre-existing test triage + final verification

**Files:** none modified.

- [ ] **Step 1: Run full test suite**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: All tests pass except the pre-existing failing test `ProjectionSnapshotQuery.test.ts` ("hydrates read model from projection tables and computes snapshot sequence"). Confirm this is the only failure.

- [ ] **Step 2: Manual smoke test**

User actions in dev:

1. Open chat with active worktree containing 2+ sessions.
2. Hover a non-active tab — within ~250ms, the WS subscription warms (no visible UI change; verify in DevTools Network or via console.debug if instrumentation is added).
3. Click the tab. Note the time displayed by `performance.measure` entries:
   ```js
   performance.getEntriesByType("measure").filter((m) => m.name.startsWith("ryco:tab-switch:"));
   ```
4. Verify: active tab highlight moves, ⌘1-⌘9 hints update, archived sessions still hidden, status dot color is correct, the active tab scrolls into view.

- [ ] **Step 3: Capture before/after measurements**

Pre-changes baseline: ask user to git stash the changes, run the manual smoke test, record `ryco:tab-switch:<key>` measure durations for 5 clicks. Unstash.

Post-changes: re-run the same 5 clicks, record durations.

Report: median + worst-case before vs. after, plus a one-line note on which fix produced the largest delta (selector vs. prefetch vs. header memo).

- [ ] **Step 4: Final commit if anything was tweaked during smoke testing**

```bash
git add -A
git commit -m "Tune tab-switch perf instrumentation defaults"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Item 1 (decompose ChatView): explicitly deferred with rationale (file size, blast radius). The headline latency win comes from items 2 and 4.
  - Item 2 (prefetch on hover): Tasks 2, 3, 5.
  - Item 3 (split message timeline from header): partially already done (MessagesTimeline + ChatHeader are already separate memo'd components). Render audit in Task 6 verifies isolation.
  - Item 4 (audit selectors): Task 4 (new targeted selector) + Task 6 (worktree summary fix if needed).
  - Item 5 (measure first): Task 1 + Task 6 (counter) + Task 7 (manual measurement).

- **Constraints honored:**
  - `bun fmt` / `bun lint` / `bun typecheck` / `bun run test` are run at multiple checkpoints.
  - `bun test` is never invoked.
  - Pre-existing `ProjectionSnapshotQuery.test.ts` failure is acknowledged and left alone.
  - No changes to PR/Issue dialog or Sidebar.
  - ⌘1-⌘9 hints, archived filter, status dots, scroll-into-view all preserved (Task 7 step 2).

- **Risk register:**
  - The targeted selector caches per-thread item references. If another consumer mutates `ChatSessionTabsItem` it would break the cache, but the type is read-only in usage and we don't expose the cache externally.
  - Prefetch warms the subscription pool — `retainThreadDetailSubscription` already has eviction logic capped at the current capacity, so a hover-storm cannot exhaust resources.
  - The `parseScopedThreadKey` helper may not exist; the plan falls back to `projectSidebarThreadsRef.current.find(...)`, which is what the current code already does.

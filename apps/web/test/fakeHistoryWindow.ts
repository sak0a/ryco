/**
 * Deterministic in-memory stand-in for the browser window surface consumed by
 * TanStack's `createBrowserHistory`: `location`, `history` (with pushState /
 * replaceState / back / forward / go and popstate dispatch), and the event
 * listener registry. Used by hosted node-route unit and integration suites so
 * URL and history behavior can be asserted without mutating the test runner's
 * real address bar.
 */

export interface FakeHistoryEntry {
  readonly url: string;
  readonly state: unknown;
}

export interface FakeHistoryWindow {
  readonly location: {
    readonly origin: string;
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
    readonly href: string;
  };
  history: {
    state: unknown;
    readonly length: number;
    pushState(state: unknown, unused: string, url?: string | null): void;
    replaceState(state: unknown, unused: string, url?: string | null): void;
    back(): void;
    forward(): void;
    go(delta?: number): void;
  };
  addEventListener(type: string, listener: (event: unknown) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: unknown) => void, options?: unknown): void;
  /** Snapshot of every retained history entry, oldest first. */
  entries(): ReadonlyArray<FakeHistoryEntry>;
  /** Index of the current entry. */
  entryIndex(): number;
}

export function createFakeHistoryWindow(
  initialUrl = "/",
  origin = "https://hub.example.test",
): FakeHistoryWindow {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const entries: Array<{ url: string; state: unknown }> = [{ url: initialUrl, state: null }];
  let index = 0;

  function split(url: string): { pathname: string; search: string; hash: string } {
    const hashIndex = url.indexOf("#");
    const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
    const searchIndex = beforeHash.indexOf("?");
    return {
      pathname: searchIndex === -1 ? beforeHash : beforeHash.slice(0, searchIndex),
      search: searchIndex === -1 ? "" : beforeHash.slice(searchIndex),
      hash: hashIndex === -1 ? "" : url.slice(hashIndex),
    };
  }

  const location = {
    origin,
    get pathname() {
      return split(entries[index]!.url).pathname;
    },
    get search() {
      return split(entries[index]!.url).search;
    },
    get hash() {
      return split(entries[index]!.url).hash;
    },
    get href() {
      return `${origin}${entries[index]!.url}`;
    },
  };

  function dispatch(type: string, event: unknown): void {
    // Snapshot so dispatch survives listener add/remove during iteration.
    for (const listener of Array.from(listeners.get(type) ?? [])) listener(event);
  }

  function go(delta: number): void {
    const next = Math.min(Math.max(index + delta, 0), entries.length - 1);
    if (next === index) return;
    index = next;
    dispatch("popstate", { state: entries[index]!.state });
  }

  const history = {
    get state() {
      return entries[index]!.state;
    },
    set state(_value: unknown) {
      throw new Error("history.state is read-only");
    },
    get length() {
      return entries.length;
    },
    pushState(state: unknown, _unused: string, url?: string | null) {
      entries.splice(index + 1);
      entries.push({ url: url ?? entries[index]!.url, state });
      index = entries.length - 1;
    },
    replaceState(state: unknown, _unused: string, url?: string | null) {
      entries[index] = { url: url ?? entries[index]!.url, state };
    },
    back() {
      go(-1);
    },
    forward() {
      go(1);
    },
    go(delta = 0) {
      go(delta);
    },
  };

  return {
    location,
    history,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    entries: () => entries.map((entry) => ({ url: entry.url, state: entry.state })),
    entryIndex: () => index,
  };
}

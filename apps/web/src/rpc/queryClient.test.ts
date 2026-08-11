import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { QueryClient } from "./queryClient.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("QueryClient retention", () => {
  it("evicts inactive payloads after gcTime", async () => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultGcTime: 20 });
    await client.fetchQuery({
      queryKey: ["preview", "file-a"],
      queryFn: () => Promise.resolve("large payload"),
      gcTime: 20,
    });

    expect(client.getCacheSize()).toBe(1);
    await vi.advanceTimersByTimeAsync(21);
    expect(client.getCacheSize()).toBe(0);
    expect(client.getQueryData(["preview", "file-a"])).toBeUndefined();
  });

  it("pins subscribed and in-flight entries", async () => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultGcTime: 10 });
    const key = ["details", "one"] as const;
    const unsubscribe = client.subscribe(key, () => undefined);
    client.setQueryData(key, "subscribed");
    await vi.advanceTimersByTimeAsync(50);
    expect(client.getCacheSize()).toBe(1);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(11);
    expect(client.getCacheSize()).toBe(0);

    let resolveFetch: ((value: string) => void) | undefined;
    const promise = client.fetch(
      ["details", "pending"],
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(client.getCacheSize()).toBe(1);
    resolveFetch?.("done");
    await promise;
    await vi.advanceTimersByTimeAsync(11);
    expect(client.getCacheSize()).toBe(0);
  });

  it("uses prefix-indexed invalidation and refetches only matching observers", async () => {
    const client = new QueryClient();
    const calls: string[] = [];
    const removeIssues = client.addObserver(["source-control", "issues", "a"], {
      refetch: () => calls.push("issues"),
    });
    const removeWorkflows = client.addObserver(["source-control", "workflows", "a"], {
      refetch: () => calls.push("workflows"),
    });
    client.setQueryData(["source-control", "issues", "a"], [1]);
    client.setQueryData(["source-control", "workflows", "a"], [2]);

    await client.invalidateQueries({ queryKey: ["source-control", "issues"] });
    expect(calls).toEqual(["issues"]);
    expect(client.isStale(["source-control", "issues", "a"], 60_000)).toBe(true);
    expect(client.isStale(["source-control", "workflows", "a"], 60_000)).toBe(false);

    removeIssues();
    removeWorkflows();
    client.clear();
  });

  it("evicts least-recent inactive entries before active entries at capacity", () => {
    const client = new QueryClient({ maxEntries: 2, defaultGcTime: 60_000 });
    client.setQueryData(["item", "old"], "old");
    const unsubscribe = client.subscribe(["item", "active"], () => undefined);
    client.setQueryData(["item", "active"], "active");
    client.setQueryData(["item", "new"], "new");

    expect(client.getQueryData(["item", "old"])).toBeUndefined();
    expect(client.getQueryData(["item", "active"])).toBe("active");
    expect(client.getQueryData(["item", "new"])).toBe("new");

    unsubscribe();
    client.clear();
  });
});

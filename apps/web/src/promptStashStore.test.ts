import {
  PROMPT_STASH_MAX_ENTRIES,
  PROMPT_STASH_STORAGE_KEY,
  type PromptStashEntry,
} from "@ryco/client-runtime/state/composer";
import { describe, expect, it, vi } from "vite-plus/test";

import { createPromptStashStore, type PromptStashStorage } from "./promptStashStore";

function entry(id: string): PromptStashEntry {
  return {
    id,
    createdAt: "2026-07-31T12:00:00.000Z",
    prompt: id,
    attachments: [],
    droppedImageNames: [],
    unreadableImageNames: [],
    pendingImageCount: 0,
  };
}

function memoryStorage(): PromptStashStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("promptStashStore", () => {
  it("hydrates malformed and missing storage as empty", () => {
    const missing = createPromptStashStore({
      getDurableStorage: () => memoryStorage(),
    });
    expect(missing.getState().entries).toEqual([]);

    const malformedStorage = memoryStorage();
    malformedStorage.setItem(PROMPT_STASH_STORAGE_KEY, "{no");
    const removeSpy = vi.spyOn(malformedStorage, "removeItem");
    const malformed = createPromptStashStore({
      getDurableStorage: () => malformedStorage,
    });
    expect(malformed.getState().entries).toEqual([]);
    expect(removeSpy).toHaveBeenCalledWith(PROMPT_STASH_STORAGE_KEY);
  });

  it("uses one global LIFO queue and evicts the oldest past 20 entries", () => {
    const store = createPromptStashStore({
      getDurableStorage: () => memoryStorage(),
    });
    for (let index = 0; index < PROMPT_STASH_MAX_ENTRIES; index += 1) {
      store.getState().stashEntry(entry(`entry-${index}`));
    }
    const result = store.getState().stashEntry(entry("newest"));
    expect(result.evicted?.id).toBe("entry-0");
    expect(store.getState().entries).toHaveLength(PROMPT_STASH_MAX_ENTRIES);
    expect(store.getState().entries[0]?.id).toBe("newest");
  });

  it("takes an entry atomically only once", () => {
    const store = createPromptStashStore({
      getDurableStorage: () => memoryStorage(),
    });
    store.getState().stashEntry(entry("once"));
    expect(store.getState().takeEntry("once").entry?.id).toBe("once");
    expect(store.getState().takeEntry("once").entry).toBeNull();
  });

  it("falls back to memory when storage property access throws", () => {
    const store = createPromptStashStore({
      getDurableStorage: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    const result = store.getState().stashEntry(entry("memory"));
    expect(result).toMatchObject({ written: true, durable: false });
    expect(store.getState().entries.map((candidate) => candidate.id)).toEqual(["memory"]);
  });

  it("falls back to memory when durable getItem throws", () => {
    const durable = memoryStorage();
    durable.getItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    const store = createPromptStashStore({
      getDurableStorage: () => durable,
    });
    expect(store.getState().stashEntry(entry("read-fallback"))).toMatchObject({
      written: true,
      durable: false,
    });
  });

  it("falls back to memory when durable setItem throws", () => {
    const durable = memoryStorage();
    durable.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    const store = createPromptStashStore({
      getDurableStorage: () => durable,
    });
    expect(store.getState().stashEntry(entry("fallback"))).toMatchObject({
      written: true,
      durable: false,
    });
  });

  it("guards removeItem when malformed durable storage cannot be cleaned up", () => {
    const durable = memoryStorage();
    durable.setItem(PROMPT_STASH_STORAGE_KEY, "{no");
    durable.removeItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(() =>
      createPromptStashStore({
        getDurableStorage: () => durable,
      }),
    ).not.toThrow();
  });

  it("leaves no visible entry when every write path fails", () => {
    const failedMemory = memoryStorage();
    failedMemory.setItem = () => {
      throw new Error("memory failed");
    };
    const store = createPromptStashStore({
      hosted: true,
      memoryStorage: failedMemory,
    });
    expect(store.getState().stashEntry(entry("unchanged"))).toMatchObject({
      written: false,
      durable: false,
    });
    expect(store.getState().entries).toEqual([]);
  });

  it("uses memory only in hosted mode without resolving durable storage", () => {
    const durableAccessor = vi.fn<() => PromptStashStorage | null>(() => memoryStorage());
    const store = createPromptStashStore({
      hosted: true,
      getDurableStorage: durableAccessor,
    });
    expect(store.getState().stashEntry(entry("hosted"))).toMatchObject({
      written: true,
      durable: false,
    });
    expect(durableAccessor).not.toHaveBeenCalled();
  });

  it("safely ignores image finalization after an entry was taken", () => {
    const store = createPromptStashStore({
      getDurableStorage: () => memoryStorage(),
    });
    store.getState().stashEntry({ ...entry("racing"), pendingImageCount: 1 });
    store.getState().takeEntry("racing");
    const result = store.getState().finalizeEntryImages("racing", {
      attachments: [],
      droppedImageNames: [],
      unreadableImageNames: [],
    });
    expect(result).toEqual({ attached: false, written: true, durable: true });
    expect(store.getState().entries).toEqual([]);
  });
});

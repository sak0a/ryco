import {
  hydratePromptStashState,
  partitionPromptStashAttachments,
  partitionPromptStashEntries,
  PROMPT_STASH_STORAGE_KEY,
  promptStashEntriesAttachmentCharacters,
  PromptStashEntry,
  type PersistedComposerImageAttachment,
  type PromptStashEntry as PromptStashEntryType,
} from "@ryco/client-runtime/state/composer";
import * as Schema from "effect/Schema";
import { create } from "zustand";

import { isHostedHubMode } from "./env";

export interface PromptStashStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

interface PromptStashPersistenceResult {
  written: boolean;
  durable: boolean;
}

interface PromptStashPersistence {
  read: () => string | null;
  write: (entries: ReadonlyArray<PromptStashEntryType>) => PromptStashPersistenceResult;
  remove: () => { durable: boolean };
}

export interface PromptStashStoreOptions {
  hosted?: boolean;
  getDurableStorage?: () => PromptStashStorage | null;
  memoryStorage?: PromptStashStorage;
}

function createSessionMemoryStorage(): PromptStashStorage {
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

function defaultDurableStorage(): PromptStashStorage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    // Reading the property itself can throw in sandboxed/blocked contexts.
    return window.localStorage;
  } catch {
    return null;
  }
}

function createPromptStashPersistence(options: PromptStashStoreOptions): PromptStashPersistence {
  const memoryStorage = options.memoryStorage ?? createSessionMemoryStorage();
  const hosted = options.hosted ?? false;
  let memoryOnly = hosted;
  let durableStorage: PromptStashStorage | null | undefined;

  const resolveDurableStorage = (): PromptStashStorage | null => {
    if (memoryOnly) return null;
    if (durableStorage !== undefined) return durableStorage;
    try {
      durableStorage = (options.getDurableStorage ?? defaultDurableStorage)();
    } catch {
      durableStorage = null;
    }
    if (!durableStorage) {
      memoryOnly = true;
    }
    return durableStorage;
  };

  const readFromMemory = (): string | null => {
    try {
      return memoryStorage.getItem(PROMPT_STASH_STORAGE_KEY);
    } catch {
      return null;
    }
  };

  return {
    read: () => {
      const durable = resolveDurableStorage();
      if (durable) {
        try {
          return durable.getItem(PROMPT_STASH_STORAGE_KEY);
        } catch {
          memoryOnly = true;
        }
      }
      return readFromMemory();
    },
    write: (entries) => {
      const serialized = JSON.stringify({ entries });
      const durable = resolveDurableStorage();
      if (durable) {
        try {
          durable.setItem(PROMPT_STASH_STORAGE_KEY, serialized);
          return { written: true, durable: true };
        } catch {
          memoryOnly = true;
        }
      }
      try {
        memoryStorage.setItem(PROMPT_STASH_STORAGE_KEY, serialized);
        return { written: true, durable: false };
      } catch {
        return { written: false, durable: false };
      }
    },
    remove: () => {
      const durable = resolveDurableStorage();
      if (durable) {
        try {
          durable.removeItem(PROMPT_STASH_STORAGE_KEY);
          return { durable: true };
        } catch {
          memoryOnly = true;
        }
      }
      try {
        memoryStorage.removeItem(PROMPT_STASH_STORAGE_KEY);
      } catch {
        // A cleanup failure must not make hydration throw.
      }
      return { durable: false };
    },
  };
}

export interface PromptStashImageFinalization {
  attachments: ReadonlyArray<PersistedComposerImageAttachment>;
  droppedImageNames: ReadonlyArray<string>;
  unreadableImageNames: ReadonlyArray<string>;
}

export interface PromptStashStoreState {
  entries: ReadonlyArray<PromptStashEntryType>;
  hydrate: () => void;
  getEntries: () => ReadonlyArray<PromptStashEntryType>;
  getCount: () => number;
  stashEntry: (entry: PromptStashEntryType) => {
    evicted: PromptStashEntryType | null;
    written: boolean;
    durable: boolean;
  };
  takeEntry: (id: string) => {
    entry: PromptStashEntryType | null;
    durable: boolean;
  };
  finalizeEntryImages: (
    id: string,
    result: PromptStashImageFinalization,
  ) => {
    attached: boolean;
    written: boolean;
    durable: boolean;
  };
}

export function createPromptStashStore(options: PromptStashStoreOptions = {}) {
  const persistence = createPromptStashPersistence(options);
  const store = create<PromptStashStoreState>()((set, get) => ({
    entries: [],
    hydrate: () => {
      const raw = persistence.read();
      if (typeof raw !== "string" || raw.length === 0) {
        set({ entries: [] });
        return;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        set({ entries: hydratePromptStashState(parsed).entries });
      } catch {
        persistence.remove();
        set({ entries: [] });
      }
    },
    getEntries: () => get().entries,
    getCount: () => get().entries.length,
    stashEntry: (entry) => {
      if (!Schema.is(PromptStashEntry)(entry)) {
        return { evicted: null, written: false, durable: false };
      }

      const entries = get().entries;
      const entryPartition = partitionPromptStashEntries([entry, ...entries]);
      const retainedEntries = entryPartition.kept.slice(1);
      const evicted = entryPartition.evicted[0] ?? null;
      const partition = partitionPromptStashAttachments(
        entry.attachments,
        promptStashEntriesAttachmentCharacters(retainedEntries),
      );
      const nextEntry: PromptStashEntryType = {
        ...entry,
        attachments: partition.kept,
        droppedImageNames: [...entry.droppedImageNames, ...partition.droppedNames],
      };
      const nextEntries = [nextEntry, ...retainedEntries];
      const write = persistence.write(nextEntries);
      if (!write.written) {
        return { evicted: null, ...write };
      }
      set({ entries: nextEntries });
      return { evicted, ...write };
    },
    takeEntry: (id) => {
      const entries = get().entries;
      const entry = entries.find((candidate) => candidate.id === id) ?? null;
      if (!entry) {
        return { entry: null, durable: true };
      }
      const nextEntries = entries.filter((candidate) => candidate.id !== id);
      const write = persistence.write(nextEntries);
      // Taking is deliberately atomic in visible state even when the durable
      // delete fails; the durability result tells callers it may reappear.
      set({ entries: nextEntries });
      return { entry, durable: write.durable };
    },
    finalizeEntryImages: (id, result) => {
      const entries = get().entries;
      const index = entries.findIndex((candidate) => candidate.id === id);
      const current = index < 0 ? undefined : entries[index];
      if (!current) {
        return { attached: false, written: true, durable: true };
      }
      const partition = partitionPromptStashAttachments(
        result.attachments,
        promptStashEntriesAttachmentCharacters(entries, id),
      );
      const nextEntries = [...entries];
      nextEntries[index] = {
        ...current,
        attachments: partition.kept,
        droppedImageNames: [...result.droppedImageNames, ...partition.droppedNames],
        unreadableImageNames: [...result.unreadableImageNames],
        pendingImageCount: 0,
      };
      const write = persistence.write(nextEntries);
      if (!write.written) {
        return { attached: false, ...write };
      }
      set({ entries: nextEntries });
      return { attached: true, ...write };
    },
  }));

  store.getState().hydrate();
  return store;
}

export const usePromptStashStore = createPromptStashStore({
  hosted: isHostedHubMode(),
});

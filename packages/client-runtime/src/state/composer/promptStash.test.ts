import { describe, expect, it } from "vite-plus/test";

import {
  hydratePromptStashState,
  partitionPromptStashAttachments,
  partitionPromptStashEntries,
  PROMPT_STASH_MAX_ENTRY_ATTACHMENT_CHARS,
  PROMPT_STASH_MAX_TOTAL_ATTACHMENT_CHARS,
  type PromptStashEntry,
} from "./promptStash.ts";

function attachment(id: string, chars: number) {
  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: chars,
    dataUrl: "x".repeat(chars),
  };
}

function entry(id: string, attachments = [] as ReturnType<typeof attachment>[]): PromptStashEntry {
  return {
    id,
    createdAt: "2026-07-31T12:00:00.000Z",
    prompt: id,
    attachments,
    droppedImageNames: [],
    unreadableImageNames: [],
    pendingImageCount: 0,
  };
}

describe("prompt stash hydration", () => {
  it("treats malformed state as empty and keeps valid siblings", () => {
    expect(hydratePromptStashState(null)).toEqual({ entries: [] });
    expect(hydratePromptStashState({ entries: "nope" })).toEqual({ entries: [] });

    const hydrated = hydratePromptStashState({
      entries: [{ id: false }, entry("valid"), { ...entry("bad-date"), createdAt: "never" }],
    });
    expect(hydrated.entries.map((candidate) => candidate.id)).toEqual(["valid"]);
  });

  it("settles image work orphaned by a reload", () => {
    const hydrated = hydratePromptStashState({
      entries: [{ ...entry("pending"), pendingImageCount: 2 }],
    });
    expect(hydrated.entries[0]?.pendingImageCount).toBe(0);
    expect(hydrated.entries[0]?.unreadableImageNames).toHaveLength(2);
  });
});

describe("prompt stash attachment budgets", () => {
  it("partitions the global entry budget in LIFO order", () => {
    const entries = Array.from({ length: 21 }, (_, index) => entry(`entry-${index}`));
    const result = partitionPromptStashEntries(entries);
    expect(result.kept.map((candidate) => candidate.id)).toEqual(
      entries.slice(0, 20).map((candidate) => candidate.id),
    );
    expect(result.evicted.map((candidate) => candidate.id)).toEqual(["entry-20"]);
  });

  it("partitions the per-entry budget in attachment order", () => {
    const firstChars = Math.floor(PROMPT_STASH_MAX_ENTRY_ATTACHMENT_CHARS * 0.6);
    const result = partitionPromptStashAttachments([
      attachment("first", firstChars),
      attachment("second", firstChars),
    ]);
    expect(result.kept.map((candidate) => candidate.id)).toEqual(["first"]);
    expect(result.droppedNames).toEqual(["second.png"]);
  });

  it("partitions against the aggregate budget independently of the entry budget", () => {
    const result = partitionPromptStashAttachments(
      [attachment("fits", 200_000), attachment("overflow", 200_001)],
      PROMPT_STASH_MAX_TOTAL_ATTACHMENT_CHARS - 400_000,
    );
    expect(result.kept.map((candidate) => candidate.id)).toEqual(["fits"]);
    expect(result.droppedNames).toEqual(["overflow.png"]);
  });

  it("preserves text-only entries while repairing aggregate over-budget storage", () => {
    const hydrated = hydratePromptStashState({
      entries: [
        entry("newest", [attachment("newest-image", 900_000)]),
        entry("middle", [attachment("middle-image", 900_000)]),
        entry("oldest", [attachment("oldest-image", 300_000)]),
      ],
    });
    expect(hydrated.entries).toHaveLength(3);
    expect(hydrated.entries[2]?.prompt).toBe("oldest");
    expect(hydrated.entries[2]?.attachments).toEqual([]);
    expect(hydrated.entries[2]?.droppedImageNames).toEqual(["oldest-image.png"]);
  });
});

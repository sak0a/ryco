import * as Schema from "effect/Schema";

import {
  PersistedComposerImageAttachment,
  type PersistedComposerImageAttachment as PersistedComposerImageAttachmentType,
} from "./draftPersistence.ts";

export const PROMPT_STASH_STORAGE_KEY = "ryco:prompt-stash:v1";
export const PROMPT_STASH_MAX_ENTRIES = 20;
export const PROMPT_STASH_MAX_ENTRY_ATTACHMENT_CHARS = 1_000_000;
export const PROMPT_STASH_MAX_TOTAL_ATTACHMENT_CHARS = 2_000_000;

const PromptStashName = Schema.String.check(Schema.isMaxLength(255));
const PromptStashPendingImageCount = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
);
const MAX_ORPHANED_PENDING_IMAGE_NAMES = 100;

/**
 * A provider-agnostic composer snapshot. Provider/model choices and all
 * execution/context state deliberately remain in the destination composer.
 */
export const PromptStashEntry = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  createdAt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  prompt: Schema.String,
  attachments: Schema.Array(PersistedComposerImageAttachment),
  droppedImageNames: Schema.Array(PromptStashName),
  unreadableImageNames: Schema.Array(PromptStashName),
  pendingImageCount: PromptStashPendingImageCount,
});
export type PromptStashEntry = typeof PromptStashEntry.Type;

export const PersistedPromptStashState = Schema.Struct({
  entries: Schema.Array(PromptStashEntry),
});
export type PersistedPromptStashState = typeof PersistedPromptStashState.Type;

export interface PromptStashAttachmentPartition {
  readonly kept: PersistedComposerImageAttachmentType[];
  readonly droppedNames: string[];
  readonly keptChars: number;
}

export interface PromptStashEntryPartition {
  readonly kept: PromptStashEntry[];
  readonly evicted: PromptStashEntry[];
}

export function partitionPromptStashEntries(
  entries: ReadonlyArray<PromptStashEntry>,
): PromptStashEntryPartition {
  return {
    kept: entries.slice(0, PROMPT_STASH_MAX_ENTRIES),
    evicted: entries.slice(PROMPT_STASH_MAX_ENTRIES),
  };
}

export function promptStashAttachmentCharacters(
  attachments: ReadonlyArray<PersistedComposerImageAttachmentType>,
): number {
  return attachments.reduce((total, attachment) => total + (attachment.dataUrl?.length ?? 0), 0);
}

/**
 * Admit attachments in insertion order while enforcing both the per-entry
 * and whole-stash encoded-character budgets.
 */
export function partitionPromptStashAttachments(
  attachments: ReadonlyArray<PersistedComposerImageAttachmentType>,
  aggregateCharsAlreadyUsed: number = 0,
): PromptStashAttachmentPartition {
  const kept: PersistedComposerImageAttachmentType[] = [];
  const droppedNames: string[] = [];
  let entryChars = 0;
  let aggregateChars = Math.max(0, aggregateCharsAlreadyUsed);

  for (const attachment of attachments) {
    const attachmentChars = attachment.dataUrl?.length ?? 0;
    const exceedsEntryBudget =
      entryChars + attachmentChars > PROMPT_STASH_MAX_ENTRY_ATTACHMENT_CHARS;
    const exceedsAggregateBudget =
      aggregateChars + attachmentChars > PROMPT_STASH_MAX_TOTAL_ATTACHMENT_CHARS;
    if (exceedsEntryBudget || exceedsAggregateBudget) {
      droppedNames.push(attachment.name);
      continue;
    }
    kept.push(attachment);
    entryChars += attachmentChars;
    aggregateChars += attachmentChars;
  }

  return { kept, droppedNames, keptChars: entryChars };
}

export function promptStashEntriesAttachmentCharacters(
  entries: ReadonlyArray<PromptStashEntry>,
  excludingEntryId?: string,
): number {
  return entries.reduce(
    (total, entry) =>
      entry.id === excludingEntryId
        ? total
        : total + promptStashAttachmentCharacters(entry.attachments),
    0,
  );
}

function settleOrphanedPendingImages(entry: PromptStashEntry): PromptStashEntry {
  if (entry.pendingImageCount === 0) {
    return entry;
  }
  const representedCount = Math.min(entry.pendingImageCount, MAX_ORPHANED_PENDING_IMAGE_NAMES);
  const additionalCount = entry.pendingImageCount - representedCount;
  return {
    ...entry,
    unreadableImageNames: [
      ...entry.unreadableImageNames,
      ...Array.from(
        { length: representedCount },
        (_, index) => `image ${index + 1} (not saved before reload)`,
      ),
      ...(additionalCount > 0
        ? [`${additionalCount} additional images (not saved before reload)`]
        : []),
    ],
    pendingImageCount: 0,
  };
}

/**
 * Hydrate untrusted storage without letting one malformed entry discard other
 * valid entries. Newest entries win when over-budget persisted data is
 * repaired, and text-only entries always survive attachment trimming.
 */
export function hydratePromptStashState(value: unknown): PersistedPromptStashState {
  if (!value || typeof value !== "object") {
    return { entries: [] };
  }
  const candidateEntries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(candidateEntries)) {
    return { entries: [] };
  }

  const decodedEntries: PromptStashEntry[] = [];
  for (const candidate of candidateEntries) {
    if (!Schema.is(PromptStashEntry)(candidate)) {
      continue;
    }
    if (!Number.isFinite(Date.parse(candidate.createdAt))) {
      continue;
    }
    decodedEntries.push(settleOrphanedPendingImages(candidate));
    if (decodedEntries.length === PROMPT_STASH_MAX_ENTRIES) {
      break;
    }
  }

  let aggregateChars = 0;
  const entries: PromptStashEntry[] = [];
  for (const entry of decodedEntries) {
    const partition = partitionPromptStashAttachments(entry.attachments, aggregateChars);
    aggregateChars += partition.keptChars;
    if (partition.droppedNames.length === 0) {
      entries.push(entry);
      continue;
    }
    entries.push({
      ...entry,
      attachments: partition.kept,
      droppedImageNames: [...entry.droppedImageNames, ...partition.droppedNames],
    });
  }
  return { entries };
}

import {
  type ContextCompactionTimelineEntry,
  type TimelineEntry,
  type WorkLogEntry,
} from "../../session-logic";
import {
  type ChatAttachment,
  type ChatContextAttachment,
  type ChatMessage,
  type ProposedPlan,
  type TurnDiffSummary,
} from "../../types";
import {
  type EnvironmentId,
  type MessageId,
  type ServerProviderSkill,
  type TurnId,
} from "@ryco/contracts";
import { type TimestampFormat } from "@ryco/contracts/settings";
import { type ExpandedImagePreview } from "./ExpandedImagePreview";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 1;

// ---------------------------------------------------------------------------
// Timeline row context split — streaming-frequent vs stable fields.
// `MessagesTimeline` provides two separate React contexts so that streaming
// transitions (activeTurnInProgress / isWorking / …) do not invalidate the
// stable context value (theme/cwd/skills/timestampFormat/callbacks) consumed
// by rows that only depend on stable state.
// ---------------------------------------------------------------------------

/** Frequently changing state — updates across a turn's lifecycle. */
export interface TimelineStreamingState {
  activeTurnInProgress: boolean;
  activeTurnId: TurnId | null;
  isWorking: boolean;
  isRevertingCheckpoint: boolean;
  completionSummary: string | null;
  openDiffTurnId: TurnId | null;
}

/** Infrequently changing state — settings, per-thread context, and callbacks. */
export interface TimelineStableState {
  timestampFormat: TimestampFormat;
  routeThreadKey: string;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  activeThreadEnvironmentId: EnvironmentId;
  onRevertUserMessage: (messageId: MessageId) => void;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onOpenContextAttachment: (attachment: ChatContextAttachment) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onCloseDiff: () => void;
}

/**
 * Normalizes the streaming-frequent context value, copying only the streaming
 * fields. Excess keys (e.g. accidentally-passed stable fields) are dropped so
 * the streaming context never carries stable state that would broaden churn.
 */
export function buildTimelineStreamingState(input: TimelineStreamingState): TimelineStreamingState {
  return {
    activeTurnInProgress: input.activeTurnInProgress,
    activeTurnId: input.activeTurnId,
    isWorking: input.isWorking,
    isRevertingCheckpoint: input.isRevertingCheckpoint,
    completionSummary: input.completionSummary,
    openDiffTurnId: input.openDiffTurnId,
  };
}

/**
 * Normalizes the stable context value, copying only the stable fields. Excess
 * keys (e.g. accidentally-passed streaming fields) are dropped so the stable
 * context identity is unaffected by streaming transitions.
 */
export function buildTimelineStableState(input: TimelineStableState): TimelineStableState {
  return {
    timestampFormat: input.timestampFormat,
    routeThreadKey: input.routeThreadKey,
    markdownCwd: input.markdownCwd,
    resolvedTheme: input.resolvedTheme,
    workspaceRoot: input.workspaceRoot,
    skills: input.skills,
    activeThreadEnvironmentId: input.activeThreadEnvironmentId,
    onRevertUserMessage: input.onRevertUserMessage,
    onImageExpand: input.onImageExpand,
    onOpenContextAttachment: input.onOpenContextAttachment,
    onOpenTurnDiff: input.onOpenTurnDiff,
    onCloseDiff: input.onCloseDiff,
  };
}

export function isErroredWorkEntry(entry: WorkLogEntry): boolean {
  if (entry.tone === "error") return true;
  return entry.exitCode !== undefined && entry.exitCode !== 0;
}

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showCompletionDivider: boolean;
      showAssistantCopyButton: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      revertTurnCount?: number | undefined;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      kind: "context-compaction";
      id: string;
      createdAt: string;
      marker: ContextCompactionTimelineEntry;
    }
  | { kind: "working"; id: string; createdAt: string | null };

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const hasText = text !== null && text.trim().length > 0;
  return {
    text: hasText ? text : null,
    visible: showCopyButton && hasText && !streaming,
  };
}

function deriveTerminalAssistantMessageIds(timelineEntries: ReadonlyArray<TimelineEntry>) {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>();
  let nullTurnResponseIndex = 0;

  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") {
      continue;
    }
    const { message } = timelineEntry;
    if (message.role === "user") {
      nullTurnResponseIndex += 1;
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`;
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id);
  }

  return new Set(lastAssistantMessageIdByResponseKey.values());
}

export function deriveRevertTurnCountByUserMessageId(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  inferredCheckpointTurnCountByTurnId: Readonly<Partial<Record<TurnDiffSummary["turnId"], number>>>;
}): Map<MessageId, number> {
  const byUserMessageId = new Map<MessageId, number>();
  let pendingUserMessageId: MessageId | null = null;

  for (const entry of input.timelineEntries) {
    if (entry.kind !== "message") {
      continue;
    }

    if (entry.message.role === "user") {
      pendingUserMessageId = entry.message.id;
      continue;
    }

    if (!pendingUserMessageId) {
      continue;
    }

    const summary = input.turnDiffSummaryByAssistantMessageId.get(entry.message.id);
    if (!summary) {
      continue;
    }

    const turnCount =
      summary.checkpointTurnCount ?? input.inferredCheckpointTurnCountByTurnId[summary.turnId];
    if (typeof turnCount === "number") {
      byUserMessageId.set(pendingUserMessageId, Math.max(0, turnCount - 1));
    }
    pendingUserMessageId = null;
  }

  return byUserMessageId;
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  completionDividerBeforeEntryId: string | null;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries);

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      nextRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
      });
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    if (timelineEntry.kind === "context-compaction") {
      nextRows.push({
        kind: "context-compaction",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        marker: timelineEntry.marker,
      });
      continue;
    }

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showCompletionDivider:
        timelineEntry.message.role === "assistant" &&
        input.completionDividerBeforeEntryId === timelineEntry.id,
      showAssistantCopyButton:
        timelineEntry.message.role === "assistant" &&
        terminalAssistantMessageIds.has(timelineEntry.message.id),
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
    });
  }

  if (input.isWorking) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    });
  }

  return nextRows;
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "working":
      return a.createdAt === (b as typeof a).createdAt;

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "work":
      return areWorkRowsUnchanged(a, b as typeof a);

    case "context-compaction":
      return a.marker === (b as typeof a).marker;

    case "message": {
      const bm = b as typeof a;
      return (
        areMessagesUnchanged(a.message, bm.message) &&
        a.durationStart === bm.durationStart &&
        a.showCompletionDivider === bm.showCompletionDivider &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
  }
}

function areWorkRowsUnchanged(
  previous: Extract<MessagesTimelineRow, { kind: "work" }>,
  next: Extract<MessagesTimelineRow, { kind: "work" }>,
): boolean {
  if (previous.createdAt !== next.createdAt) {
    return false;
  }
  if (previous.groupedEntries.length !== next.groupedEntries.length) {
    return false;
  }
  for (let index = 0; index < previous.groupedEntries.length; index += 1) {
    const previousEntry = previous.groupedEntries[index];
    const nextEntry = next.groupedEntries[index];
    if (!previousEntry || !nextEntry) {
      return false;
    }
    if (!areWorkLogEntriesUnchanged(previousEntry, nextEntry)) {
      return false;
    }
  }
  return true;
}

function areMessagesUnchanged(previous: ChatMessage, next: ChatMessage): boolean {
  return (
    previous === next ||
    (previous.id === next.id &&
      previous.role === next.role &&
      previous.text === next.text &&
      areChatAttachmentsUnchanged(previous.attachments, next.attachments) &&
      previous.turnId === next.turnId &&
      previous.createdAt === next.createdAt &&
      previous.completedAt === next.completedAt &&
      previous.streaming === next.streaming)
  );
}

function areWorkLogEntriesUnchanged(previous: WorkLogEntry, next: WorkLogEntry): boolean {
  return (
    previous === next ||
    (previous.id === next.id &&
      previous.createdAt === next.createdAt &&
      previous.label === next.label &&
      previous.detail === next.detail &&
      previous.command === next.command &&
      previous.rawCommand === next.rawCommand &&
      areStringArraysUnchanged(previous.changedFiles, next.changedFiles) &&
      areChangedFileStatsUnchanged(previous.changedFileStats, next.changedFileStats) &&
      previous.completed === next.completed &&
      previous.tone === next.tone &&
      previous.toolTitle === next.toolTitle &&
      previous.itemType === next.itemType &&
      previous.requestKind === next.requestKind &&
      previous.turnId === next.turnId &&
      previous.output === next.output &&
      previous.exitCode === next.exitCode)
  );
}

function areChangedFileStatsUnchanged(
  previous: WorkLogEntry["changedFileStats"],
  next: WorkLogEntry["changedFileStats"],
): boolean {
  if (previous === next) {
    return true;
  }
  const previousLength = previous?.length ?? 0;
  const nextLength = next?.length ?? 0;
  if (previousLength !== nextLength) {
    return false;
  }
  for (let index = 0; index < previousLength; index += 1) {
    const previousStat = previous?.[index];
    const nextStat = next?.[index];
    if (
      !previousStat ||
      !nextStat ||
      previousStat.path !== nextStat.path ||
      previousStat.kind !== nextStat.kind ||
      previousStat.additions !== nextStat.additions ||
      previousStat.deletions !== nextStat.deletions
    ) {
      return false;
    }
  }
  return true;
}

function areStringArraysUnchanged(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): boolean {
  if (previous === next) {
    return true;
  }
  const previousLength = previous?.length ?? 0;
  const nextLength = next?.length ?? 0;
  if (previousLength !== nextLength) {
    return false;
  }
  for (let index = 0; index < previousLength; index += 1) {
    if (previous?.[index] !== next?.[index]) {
      return false;
    }
  }
  return true;
}

function areChatAttachmentsUnchanged(
  previous: ReadonlyArray<ChatAttachment> | undefined,
  next: ReadonlyArray<ChatAttachment> | undefined,
): boolean {
  if (previous === next) {
    return true;
  }
  const previousLength = previous?.length ?? 0;
  const nextLength = next?.length ?? 0;
  if (previousLength !== nextLength) {
    return false;
  }
  for (let index = 0; index < previousLength; index += 1) {
    const previousAttachment = previous?.[index];
    const nextAttachment = next?.[index];
    if (
      !previousAttachment ||
      !nextAttachment ||
      !areChatAttachmentUnchanged(previousAttachment, nextAttachment)
    ) {
      return false;
    }
  }
  return true;
}

function areChatAttachmentUnchanged(previous: ChatAttachment, next: ChatAttachment): boolean {
  if (previous === next) {
    return true;
  }
  if (previous.type === "image" && next.type === "image") {
    return (
      previous.id === next.id &&
      previous.name === next.name &&
      previous.mimeType === next.mimeType &&
      previous.sizeBytes === next.sizeBytes &&
      previous.previewUrl === next.previewUrl
    );
  }
  if (previous.type === "context" && next.type === "context") {
    return (
      previous.id === next.id &&
      previous.kind === next.kind &&
      previous.provider === next.provider &&
      previous.reference === next.reference &&
      previous.title === next.title &&
      previous.state === next.state &&
      previous.url === next.url
    );
  }
  return false;
}

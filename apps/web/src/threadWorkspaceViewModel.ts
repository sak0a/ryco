import type { OrchestrationThreadActivity } from "@ryco/contracts";

import { deriveWorkLogEntries, type WorkLogEntry } from "./session-logic";

export type ThreadSubagentStatus = "running" | "idle" | "finished" | "failed";

export interface ThreadSubagentView {
  key: string;
  name: string;
  status: ThreadSubagentStatus;
  detail: string | null;
  startedAt: string;
  updatedAt: string;
  entries: WorkLogEntry[];
}

interface MutableThreadSubagentView {
  key: string;
  name: string | null;
  status: ThreadSubagentStatus;
  detail: string | null;
  startedAt: string;
  updatedAt: string;
  entries: WorkLogEntry[];
}

const GENERIC_SUBAGENT_TITLES = new Set([
  "agent",
  "subagent",
  "subagent task",
  "task",
  "tool call",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeForKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "agent";
}

function titleCaseCompact(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function payloadFromActivity(
  activity: OrchestrationThreadActivity,
): Record<string, unknown> | null {
  return asRecord(activity.payload);
}

function inputFromPayload(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const data = asRecord(payload?.data);
  const input = asRecord(data?.input);
  if (input) {
    return input;
  }
  const state = asRecord(data?.state);
  return asRecord(state?.input);
}

function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const state = asRecord(data?.state);
  return (
    asTrimmedString(data?.toolCallId) ??
    asTrimmedString(data?.callID) ??
    asTrimmedString(data?.callId) ??
    asTrimmedString(state?.callID) ??
    asTrimmedString(state?.callId) ??
    null
  );
}

function detailPrefix(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex > 28) {
    return null;
  }
  const prefix = value.slice(0, separatorIndex).trim();
  if (!/^[\w -]+$/.test(prefix)) {
    return null;
  }
  const normalized = prefix.toLowerCase();
  return GENERIC_SUBAGENT_TITLES.has(normalized) ? null : prefix;
}

function extractSubagentName(
  payload: Record<string, unknown> | null,
  fallbackDetail: string | null,
): string | null {
  const input = inputFromPayload(payload);
  const data = asRecord(payload?.data);
  const state = asRecord(data?.state);
  const candidates = [
    input?.subagent_type,
    input?.agent_type,
    input?.agent,
    input?.name,
    data?.agentName,
    state?.agentName,
    detailPrefix(fallbackDetail),
  ];

  for (const candidate of candidates) {
    const value = asTrimmedString(candidate);
    if (!value) {
      continue;
    }
    const normalized = value.toLowerCase();
    if (GENERIC_SUBAGENT_TITLES.has(normalized)) {
      continue;
    }
    return titleCaseCompact(value);
  }

  return null;
}

function extractSubagentDetail(
  payload: Record<string, unknown> | null,
  fallback: string | null,
): string | null {
  const input = inputFromPayload(payload);
  return (
    asTrimmedString(input?.description) ??
    asTrimmedString(input?.prompt) ??
    asTrimmedString(input?.task) ??
    asTrimmedString(payload?.detail) ??
    fallback
  );
}

function isSubagentPayload(payload: Record<string, unknown> | null): boolean {
  return payload?.itemType === "collab_agent_tool_call";
}

function statusFromActivity(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown> | null,
): ThreadSubagentStatus {
  if (payload?.status === "failed") {
    return "failed";
  }
  if (payload?.status === "completed") {
    return "finished";
  }
  if (payload?.status === "inProgress") {
    return "running";
  }
  if (activity.kind === "tool.started" || activity.kind === "tool.updated") {
    return "running";
  }
  if (activity.kind === "tool.completed") {
    return activity.tone === "error" ? "failed" : "finished";
  }
  return "idle";
}

function statusFromWorkEntry(entry: WorkLogEntry): ThreadSubagentStatus {
  if (entry.tone === "error" || (entry.exitCode !== undefined && entry.exitCode !== 0)) {
    return "failed";
  }
  return "finished";
}

function subagentKey(input: {
  toolCallId: string | null;
  name: string | null;
  detail: string | null;
  fallbackId: string;
}): string {
  if (input.toolCallId) {
    return `subagent:${normalizeForKey(input.toolCallId)}`;
  }
  if (input.name && input.detail) {
    return `subagent:${normalizeForKey(`${input.name}:${input.detail}`)}`;
  }
  if (input.detail) {
    return `subagent:${normalizeForKey(input.detail)}`;
  }
  if (input.name) {
    return `subagent:${normalizeForKey(input.name)}`;
  }
  return `subagent:${normalizeForKey(input.fallbackId)}`;
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  const leftSequence = left.sequence;
  const rightSequence = right.sequence;
  if (leftSequence !== undefined && rightSequence !== undefined && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
}

function applyStatus(
  previous: ThreadSubagentStatus,
  next: ThreadSubagentStatus,
): ThreadSubagentStatus {
  if (next === "failed") {
    return "failed";
  }
  if (previous === "failed") {
    return previous;
  }
  return next;
}

function toWorkEntrySubagentKey(entry: WorkLogEntry): string {
  const detail = entry.detail ?? entry.output ?? null;
  const name = extractSubagentName(null, detail ?? entry.toolTitle ?? entry.label);
  return subagentKey({
    toolCallId: null,
    name,
    detail: detail ?? entry.label,
    fallbackId: entry.id,
  });
}

function findSubagentByVisibleIdentity(
  subagents: ReadonlyMap<string, MutableThreadSubagentView>,
  input: { name: string | null; detail: string | null },
): MutableThreadSubagentView | null {
  for (const subagent of subagents.values()) {
    if (input.detail && subagent.detail === input.detail) {
      return subagent;
    }
    if (input.name && input.detail && subagent.name === input.name && subagent.detail === null) {
      return subagent;
    }
  }
  return null;
}

export function deriveThreadSubagents(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ThreadSubagentView[] {
  const subagents = new Map<string, MutableThreadSubagentView>();
  const orderedActivities = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of orderedActivities) {
    const payload = payloadFromActivity(activity);
    if (!isSubagentPayload(payload)) {
      continue;
    }

    const detail = extractSubagentDetail(payload, asTrimmedString(activity.summary));
    const name = extractSubagentName(payload, detail);
    const key = subagentKey({
      toolCallId: extractToolCallId(payload),
      name,
      detail,
      fallbackId: activity.id,
    });
    const existing = subagents.get(key);
    const status = statusFromActivity(activity, payload);

    if (existing) {
      existing.name = existing.name ?? name;
      existing.detail = detail ?? existing.detail;
      existing.status = applyStatus(existing.status, status);
      existing.updatedAt = activity.createdAt;
      continue;
    }

    subagents.set(key, {
      key,
      name,
      status,
      detail,
      startedAt: activity.createdAt,
      updatedAt: activity.createdAt,
      entries: [],
    });
  }

  for (const entry of deriveWorkLogEntries(activities, undefined)) {
    if (entry.itemType !== "collab_agent_tool_call") {
      continue;
    }

    const detail = entry.detail ?? entry.output ?? null;
    const name = extractSubagentName(null, detail ?? entry.toolTitle ?? entry.label);
    const key = toWorkEntrySubagentKey(entry);
    const existing =
      subagents.get(key) ?? findSubagentByVisibleIdentity(subagents, { name, detail });
    const status = statusFromWorkEntry(entry);
    if (existing) {
      existing.entries.push(entry);
      existing.status = applyStatus(existing.status, status);
      existing.updatedAt = entry.createdAt;
      continue;
    }

    subagents.set(key, {
      key,
      name,
      status,
      detail,
      startedAt: entry.createdAt,
      updatedAt: entry.createdAt,
      entries: [entry],
    });
  }

  let fallbackIndex = 1;
  return [...subagents.values()]
    .toSorted((left, right) => left.startedAt.localeCompare(right.startedAt))
    .map((subagent) => {
      const name = subagent.name ?? `Subagent ${fallbackIndex}`;
      if (!subagent.name) {
        fallbackIndex += 1;
      }
      return {
        key: subagent.key,
        name,
        status: subagent.status,
        detail: subagent.detail,
        startedAt: subagent.startedAt,
        updatedAt: subagent.updatedAt,
        entries: subagent.entries,
      };
    });
}

export function findThreadSubagent(
  subagents: ReadonlyArray<ThreadSubagentView>,
  key: string | null | undefined,
): ThreadSubagentView | null {
  if (!key) {
    return null;
  }
  return subagents.find((subagent) => subagent.key === key) ?? null;
}

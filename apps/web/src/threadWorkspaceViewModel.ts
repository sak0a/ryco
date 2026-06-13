import type { OrchestrationThreadActivity } from "@ryco/contracts";

import { deriveWorkLogEntries, type WorkLogEntry } from "./session-logic";

export type ThreadSubagentStatus = "running" | "idle" | "finished" | "failed";

export interface ThreadSubagentMessageView {
  id: string;
  text: string;
  createdAt: string;
  providerThreadId: string | null;
}

export interface ThreadSubagentView {
  key: string;
  name: string;
  status: ThreadSubagentStatus;
  tool: string | null;
  detail: string | null;
  providerThreadIds: string[];
  startedAt: string;
  updatedAt: string;
  entries: WorkLogEntry[];
  messages: ThreadSubagentMessageView[];
}

interface MutableThreadSubagentView {
  key: string;
  name: string | null;
  status: ThreadSubagentStatus;
  tool: string | null;
  detail: string | null;
  providerThreadIds: Set<string>;
  startedAt: string;
  updatedAt: string;
  entries: WorkLogEntry[];
  messages: ThreadSubagentMessageView[];
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = asTrimmedString(entry);
        return text ? [text] : [];
      })
    : [];
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

function collabItemFromPayload(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  return item?.type === "collabAgentToolCall" ? item : null;
}

function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const state = asRecord(data?.state);
  const item = collabItemFromPayload(payload);
  const providerRefs = asRecord(payload?.providerRefs);
  return (
    asTrimmedString(payload?.providerItemId) ??
    asTrimmedString(providerRefs?.providerItemId) ??
    asTrimmedString(item?.id) ??
    asTrimmedString(data?.toolCallId) ??
    asTrimmedString(data?.callID) ??
    asTrimmedString(data?.callId) ??
    asTrimmedString(state?.callID) ??
    asTrimmedString(state?.callId) ??
    null
  );
}

function extractProviderThreadIds(payload: Record<string, unknown> | null): string[] {
  const item = collabItemFromPayload(payload);
  if (!item) {
    return [];
  }
  return asStringArray(item.receiverThreadIds);
}

function extractSubagentTool(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(collabItemFromPayload(payload)?.tool);
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
    input?.agent_role,
    input?.agent,
    input?.name,
    data?.agentName,
    state?.agentName,
    detailPrefix(fallbackDetail),
    inferRoleFromPrompt(fallbackDetail),
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

function inferRoleFromPrompt(prompt: string | null): string | null {
  if (!prompt) {
    return null;
  }
  const match =
    /\byou are an?\s+([a-z][a-z0-9 _-]{1,40}?)(?:[,.!?;:\n]|\s+who\s+|\s+tasked\s+|\s+responsible\s+|$)/i.exec(
      prompt,
    );
  const role = asTrimmedString(match?.[1]);
  if (!role) {
    return null;
  }
  const normalized = role.toLowerCase();
  if (GENERIC_SUBAGENT_TITLES.has(normalized)) {
    return null;
  }
  return titleCaseCompact(role);
}

function firstCollabAgentStateMessage(item: Record<string, unknown> | null): string | null {
  const states = asRecord(item?.agentsStates);
  if (!states) {
    return null;
  }
  for (const state of Object.values(states)) {
    const message = asTrimmedString(asRecord(state)?.message);
    if (message) {
      return message;
    }
  }
  return null;
}

function extractSubagentDetail(
  payload: Record<string, unknown> | null,
  fallback: string | null,
): string | null {
  const input = inputFromPayload(payload);
  const item = collabItemFromPayload(payload);
  return (
    asTrimmedString(item?.prompt) ??
    firstCollabAgentStateMessage(item) ??
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

function statusFromCollabAgentStatus(status: string | null): ThreadSubagentStatus | null {
  switch (status) {
    case "pendingInit":
    case "running":
      return "running";
    case "completed":
    case "shutdown":
      return "finished";
    case "errored":
    case "interrupted":
    case "notFound":
      return "failed";
    default:
      return null;
  }
}

function statusFromCollabItem(
  payload: Record<string, unknown> | null,
): ThreadSubagentStatus | null {
  const item = collabItemFromPayload(payload);
  const itemStatus = asTrimmedString(item?.status);
  if (itemStatus === "failed") {
    return "failed";
  }
  if (itemStatus === "completed") {
    return "finished";
  }
  if (itemStatus === "inProgress") {
    return "running";
  }

  const states = asRecord(item?.agentsStates);
  if (!states) {
    return null;
  }
  let sawRunning = false;
  let sawFinished = false;
  for (const state of Object.values(states)) {
    const status = statusFromCollabAgentStatus(asTrimmedString(asRecord(state)?.status));
    if (status === "failed") {
      return "failed";
    }
    if (status === "running") {
      sawRunning = true;
    }
    if (status === "finished") {
      sawFinished = true;
    }
  }
  if (sawRunning) {
    return "running";
  }
  if (sawFinished) {
    return "finished";
  }
  return null;
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
  const collabStatus = statusFromCollabItem(payload);
  if (collabStatus) {
    return collabStatus;
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

function mergeProviderThreadIds(target: Set<string>, ids: ReadonlyArray<string>): void {
  for (const id of ids) {
    target.add(id);
  }
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

function findSubagentByProviderThreadId(
  subagents: ReadonlyMap<string, MutableThreadSubagentView>,
  providerThreadId: string | null,
): MutableThreadSubagentView | null {
  if (!providerThreadId) {
    return null;
  }
  for (const subagent of subagents.values()) {
    if (subagent.providerThreadIds.has(providerThreadId)) {
      return subagent;
    }
  }
  return null;
}

function messageFromActivity(
  activity: OrchestrationThreadActivity,
): ThreadSubagentMessageView | null {
  if (activity.kind !== "agent.message") {
    return null;
  }
  const payload = payloadFromActivity(activity);
  const text = asTrimmedString(payload?.text);
  if (!text) {
    return null;
  }
  return {
    id: asTrimmedString(payload?.providerItemId) ?? activity.id,
    text,
    createdAt: activity.createdAt,
    providerThreadId: asTrimmedString(payload?.providerThreadId),
  };
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
    const providerThreadIds = extractProviderThreadIds(payload);
    const tool = extractSubagentTool(payload);
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
      existing.tool = existing.tool ?? tool;
      mergeProviderThreadIds(existing.providerThreadIds, providerThreadIds);
      existing.status = applyStatus(existing.status, status);
      existing.updatedAt = activity.createdAt;
      continue;
    }

    subagents.set(key, {
      key,
      name,
      status,
      tool,
      detail,
      providerThreadIds: new Set(providerThreadIds),
      startedAt: activity.createdAt,
      updatedAt: activity.createdAt,
      entries: [],
      messages: [],
    });
  }

  for (const activity of orderedActivities) {
    const message = messageFromActivity(activity);
    if (!message) {
      continue;
    }
    const subagent = findSubagentByProviderThreadId(subagents, message.providerThreadId);
    if (!subagent) {
      continue;
    }
    subagent.messages.push(message);
    subagent.updatedAt = activity.createdAt;
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
      tool: null,
      detail,
      providerThreadIds: new Set(),
      startedAt: entry.createdAt,
      updatedAt: entry.createdAt,
      entries: [entry],
      messages: [],
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
        tool: subagent.tool,
        detail: subagent.detail,
        providerThreadIds: [...subagent.providerThreadIds],
        startedAt: subagent.startedAt,
        updatedAt: subagent.updatedAt,
        entries: subagent.entries,
        messages: subagent.messages.toSorted((left, right) =>
          left.createdAt.localeCompare(right.createdAt),
        ),
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

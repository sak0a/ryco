import type { OrchestrationThreadActivity } from "@ryco/contracts";

import { deriveWorkLogEntries, type WorkLogEntry } from "./session-logic.ts";

export type ThreadSubagentStatus = "running" | "idle" | "finished" | "failed";

export interface ThreadSubagentMessageView {
  id: string;
  text: string;
  createdAt: string;
  providerThreadId: string | null;
}

export interface ThreadSubagentView {
  key: string;
  /** Stable, unique abstract codename used as the subagent's primary identity. */
  name: string;
  /** Inferred descriptive role (e.g. "Code Reviewer"), shown as a subtitle. */
  role?: string | null;
  status: ThreadSubagentStatus;
  origin?: string | null;
  capability?: string | null;
  tool: string | null;
  detail: string | null;
  providerThreadIds: string[];
  providerSessionIds?: string[];
  startedAt: string;
  updatedAt: string;
  entries: WorkLogEntry[];
  messages: ThreadSubagentMessageView[];
}

interface MutableThreadSubagentView {
  key: string;
  name: string | null;
  status: ThreadSubagentStatus;
  origin: string | null;
  capability: string | null;
  tool: string | null;
  detail: string | null;
  providerThreadIds: Set<string>;
  providerSessionIds: Set<string>;
  startedAt: string;
  updatedAt: string;
  entries: WorkLogEntry[];
  messages: ThreadSubagentMessageView[];
}

type InternalThreadSubagentMessageView = ThreadSubagentMessageView & {
  subagentKey: string | null;
};

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

function canonicalSubagentFromPayload(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return asRecord(payload?.subagent);
}

function metadataFromSubagent(
  subagent: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return asRecord(subagent?.metadata);
}

function canonicalSubagentKey(subagentId: string): string {
  return `subagent:${subagentId}`;
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

function extractCanonicalSubagentId(payload: Record<string, unknown> | null): string | null {
  const subagent = canonicalSubagentFromPayload(payload);
  return asTrimmedString(subagent?.subagentId) ?? asTrimmedString(payload?.subagentId);
}

function extractProviderThreadIds(payload: Record<string, unknown> | null): string[] {
  const subagent = canonicalSubagentFromPayload(payload);
  const canonicalIds = [
    asTrimmedString(subagent?.providerThreadId),
    ...asStringArray(subagent?.providerThreadIds),
    asTrimmedString(payload?.providerThreadId),
  ].filter((id): id is string => id !== null);
  if (canonicalIds.length > 0) {
    return [...new Set(canonicalIds)];
  }

  const item = collabItemFromPayload(payload);
  if (!item) {
    return [];
  }
  return asStringArray(item.receiverThreadIds);
}

function extractProviderSessionIds(payload: Record<string, unknown> | null): string[] {
  const subagent = canonicalSubagentFromPayload(payload);
  return [
    asTrimmedString(subagent?.providerSessionId),
    ...asStringArray(subagent?.providerSessionIds),
    asTrimmedString(payload?.providerSessionId),
  ].filter((id): id is string => id !== null);
}

function extractSubagentTool(payload: Record<string, unknown> | null): string | null {
  return (
    asTrimmedString(payload?.lastToolName) ??
    asTrimmedString(canonicalSubagentFromPayload(payload)?.providerTaskId) ??
    asTrimmedString(collabItemFromPayload(payload)?.tool)
  );
}

function extractSubagentOrigin(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(canonicalSubagentFromPayload(payload)?.origin);
}

function extractSubagentCapability(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(canonicalSubagentFromPayload(payload)?.capability);
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
  const subagent = canonicalSubagentFromPayload(payload);
  const metadata = metadataFromSubagent(subagent);
  const candidates = [
    subagent?.label,
    subagent?.displayName,
    subagent?.role,
    subagent?.name,
    metadata?.label,
    metadata?.displayName,
    metadata?.role,
    metadata?.name,
    metadata?.title,
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
  const subagent = canonicalSubagentFromPayload(payload);
  const metadata = metadataFromSubagent(subagent);
  return (
    asTrimmedString(item?.prompt) ??
    firstCollabAgentStateMessage(item) ??
    asTrimmedString(payload?.summary) ??
    asTrimmedString(payload?.detail) ??
    asTrimmedString(subagent?.description) ??
    asTrimmedString(subagent?.detail) ??
    asTrimmedString(metadata?.description) ??
    asTrimmedString(metadata?.detail) ??
    asTrimmedString(input?.description) ??
    asTrimmedString(input?.prompt) ??
    asTrimmedString(input?.task) ??
    asTrimmedString(payload?.detail) ??
    fallback
  );
}

function isSubagentPayload(payload: Record<string, unknown> | null): boolean {
  return payload?.itemType === "collab_agent_tool_call" || payload?.itemType === "subagent";
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
  if (payload?.status === "starting" || payload?.status === "running") {
    return "running";
  }
  if (payload?.status === "failed") {
    return "failed";
  }
  if (payload?.status === "completed" || payload?.status === "stopped") {
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
  canonicalSubagentId?: string | null;
  toolCallId: string | null;
  name: string | null;
  detail: string | null;
  fallbackId: string;
}): string {
  if (input.canonicalSubagentId) {
    return canonicalSubagentKey(input.canonicalSubagentId);
  }
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

function mergeStringSet(target: Set<string>, values: ReadonlyArray<string>): void {
  for (const value of values) {
    target.add(value);
  }
}

function toWorkEntrySubagentKey(entry: WorkLogEntry): string {
  const detail = entry.detail ?? entry.output ?? null;
  const name = extractSubagentName(null, detail ?? entry.toolTitle ?? entry.label);
  return subagentKey({
    canonicalSubagentId: null,
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
): InternalThreadSubagentMessageView | null {
  if (activity.kind !== "agent.message" && !activity.kind.startsWith("subagent.message")) {
    return null;
  }
  const payload = payloadFromActivity(activity);
  const subagent = canonicalSubagentFromPayload(payload);
  const providerRefs = asRecord(payload?.providerRefs);
  const subagentId = extractCanonicalSubagentId(payload);
  const text =
    asTrimmedString(payload?.text) ??
    asTrimmedString(payload?.delta) ??
    asTrimmedString(payload?.summary);
  if (!text) {
    return null;
  }
  return {
    id:
      asTrimmedString(payload?.providerItemId) ??
      asTrimmedString(providerRefs?.providerItemId) ??
      activity.id,
    text,
    createdAt: activity.createdAt,
    providerThreadId:
      asTrimmedString(payload?.providerThreadId) ??
      asTrimmedString(subagent?.providerThreadId) ??
      asTrimmedString(payload?.providerSessionId) ??
      asTrimmedString(subagent?.providerSessionId),
    subagentKey: subagentId ? canonicalSubagentKey(subagentId) : null,
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

/**
 * Distinct, memorable codenames (scientists and philosophers) used to identify
 * subagents that carry no inferable role. Far nicer than "Subagent 1, 2, 3…":
 * each agent gets a stable, unique handle that pairs with its colored avatar.
 */
const SUBAGENT_CODENAMES = [
  "Turing",
  "Dirac",
  "Hegel",
  "Arendt",
  "Boyle",
  "Locke",
  "Epicurus",
  "Curie",
  "Bohr",
  "Newton",
  "Euler",
  "Gauss",
  "Hopper",
  "Lovelace",
  "Noether",
  "Pascal",
  "Tesla",
  "Darwin",
  "Kepler",
  "Faraday",
  "Planck",
  "Heisenberg",
  "Maxwell",
  "Fermi",
  "Feynman",
  "Lagrange",
  "Riemann",
  "Babbage",
  "Shannon",
  "Ramanujan",
  "Galileo",
  "Copernicus",
  "Pasteur",
  "Mendel",
  "Hawking",
  "Lavoisier",
  "Fourier",
  "Pauli",
  "Kant",
  "Plato",
  "Socrates",
  "Aristotle",
  "Nietzsche",
  "Spinoza",
  "Descartes",
  "Hume",
  "Leibniz",
  "Wittgenstein",
  "Russell",
  "Camus",
  "Sartre",
  "Voltaire",
  "Confucius",
  "Seneca",
  "Aurelius",
  "Diogenes",
] as const;

function hashSubagentSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Builds a deterministic preference order over the whole codename pool for a
 * seed. The permutation depends only on the seed, so two subagents that would
 * pick the same first codename fall back to different alternates in a stable,
 * order-independent way.
 */
function codenamePreferenceOrder(seed: string): number[] {
  const order = Array.from({ length: SUBAGENT_CODENAMES.length }, (_, index) => index);
  // Fisher–Yates shuffle driven by a seed-derived PRNG (no Math.random, so the
  // permutation is reproducible for a given seed).
  let state = hashSubagentSeed(seed) || 1;
  for (let i = order.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 0x01000193) ^ (i + 1)) >>> 0;
    const j = state % (i + 1);
    const swap = order[i]!;
    order[i] = order[j]!;
    order[j] = swap;
  }
  return order;
}

/**
 * Assigns a unique codename to every subagent key. Keys are resolved in sorted
 * order and each takes the first free codename in its own seed-derived
 * preference order, so the mapping is a pure function of the key set — a given
 * subagent keeps the same codename (and therefore avatar) regardless of the
 * order activities arrive or are backfilled.
 */
function assignSubagentCodenames(keys: ReadonlyArray<string>): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const key of [...keys].toSorted((left, right) => left.localeCompare(right))) {
    if (names.has(key)) {
      continue;
    }
    const preference = codenamePreferenceOrder(key);
    let chosen: string | null = null;
    for (const index of preference) {
      const candidate = SUBAGENT_CODENAMES[index]!;
      if (!taken.has(candidate.toLowerCase())) {
        chosen = candidate;
        break;
      }
    }
    if (chosen === null) {
      // More subagents than codenames: append a numeric suffix to the seed's top
      // choice, still resolved within the fixed key ordering above.
      const base = SUBAGENT_CODENAMES[preference[0]!]!;
      let suffix = 2;
      while (taken.has(`${base} ${suffix}`.toLowerCase())) {
        suffix += 1;
      }
      chosen = `${base} ${suffix}`;
    }
    taken.add(chosen.toLowerCase());
    names.set(key, chosen);
  }
  return names;
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
    const canonicalSubagentId = extractCanonicalSubagentId(payload);
    const providerThreadIds = extractProviderThreadIds(payload);
    const providerSessionIds = extractProviderSessionIds(payload);
    const origin = extractSubagentOrigin(payload);
    const capability = extractSubagentCapability(payload);
    const tool = extractSubagentTool(payload);
    const key = subagentKey({
      canonicalSubagentId,
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
      existing.origin = existing.origin ?? origin;
      existing.capability = existing.capability ?? capability;
      existing.tool = existing.tool ?? tool;
      mergeProviderThreadIds(existing.providerThreadIds, providerThreadIds);
      mergeStringSet(existing.providerSessionIds, providerSessionIds);
      existing.status = applyStatus(existing.status, status);
      existing.updatedAt = activity.createdAt;
      continue;
    }

    subagents.set(key, {
      key,
      name,
      status,
      origin,
      capability,
      tool,
      detail,
      providerThreadIds: new Set(providerThreadIds),
      providerSessionIds: new Set(providerSessionIds),
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
    const subagent = message.subagentKey
      ? (subagents.get(message.subagentKey) ?? null)
      : findSubagentByProviderThreadId(subagents, message.providerThreadId);
    if (!subagent) {
      continue;
    }
    const { subagentKey: _subagentKey, ...messageView } = message;
    subagent.messages.push(messageView);
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
      origin: null,
      capability: null,
      tool: null,
      detail,
      providerThreadIds: new Set(),
      providerSessionIds: new Set(),
      startedAt: entry.createdAt,
      updatedAt: entry.createdAt,
      entries: [entry],
      messages: [],
    });
  }

  const ordered = [...subagents.values()].toSorted((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  );

  // Every subagent gets a stable, unique abstract codename as its primary
  // identity; any inferred descriptive label is demoted to `role` (a subtitle).
  const codenamesByKey = assignSubagentCodenames(ordered.map((subagent) => subagent.key));

  return ordered.map((subagent) => {
    return {
      key: subagent.key,
      name: codenamesByKey.get(subagent.key) ?? subagent.key,
      role: subagent.name,
      status: subagent.status,
      origin: subagent.origin,
      capability: subagent.capability,
      tool: subagent.tool,
      detail: subagent.detail,
      providerThreadIds: [...subagent.providerThreadIds],
      providerSessionIds: [...subagent.providerSessionIds],
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

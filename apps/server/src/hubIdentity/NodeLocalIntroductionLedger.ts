import {
  LTI_DIGEST_BYTES,
  LTI_ID_BYTES,
  LTI_LEDGER_MAX_ENTRIES,
  LTI_LEDGER_RETENTION_MS,
  LTI_MAX_TRANSCRIPT_BYTES,
} from "@ryco/shared/relayE2eeLocalIntroduction";

import { openProtectedStateFile, type ProtectedStateFileFailure } from "./ProtectedStateFile.ts";

// The bounded node-local replay ledger from
// docs/relay-e2ee-local-introduction-protocol.md §8. It contains public
// transcript material only and still uses the protected state-file discipline:
// a downgrade or partial write must never turn one introduction id into two
// different authority grants.

export type NodeLocalIntroductionLedgerErrorCode =
  | "local_introduction_ledger_unavailable"
  | "local_introduction_ledger_locked"
  | "local_introduction_ledger_corrupt"
  | "local_introduction_ledger_operation_failed"
  | "local_introduction_ledger_conflict";

export class NodeLocalIntroductionLedgerError extends Error {
  readonly code: NodeLocalIntroductionLedgerErrorCode;

  constructor(code: NodeLocalIntroductionLedgerErrorCode) {
    super("Local introduction replay state operation failed.");
    this.name = "NodeLocalIntroductionLedgerError";
    this.code = code;
  }
}

function ledgerError(code: NodeLocalIntroductionLedgerErrorCode): never {
  throw new NodeLocalIntroductionLedgerError(code);
}

export interface NodeLocalIntroductionLedgerEntry {
  readonly introductionId: string;
  readonly requestDigest: string;
  readonly approvalTbs: string;
  readonly approvalSignature: string;
  readonly approvedAt: number;
  readonly recordedAt: number;
  readonly forwardFields?: Readonly<Record<string, unknown>> | undefined;
}

interface LedgerRecord {
  readonly version: 1;
  readonly revision: number;
  readonly entries: readonly NodeLocalIntroductionLedgerEntry[];
}

interface StoredLedger {
  readonly record: LedgerRecord;
  readonly forwardFields: Readonly<Record<string, unknown>>;
}

export interface NodeLocalIntroductionLedger {
  readonly get: (
    introductionId: Uint8Array,
  ) => Promise<NodeLocalIntroductionLedgerEntry | undefined>;
  readonly commit: (input: {
    readonly introductionId: Uint8Array;
    readonly requestDigest: Uint8Array;
    readonly approvalTbs: Uint8Array;
    readonly approvalSignature: Uint8Array;
    readonly approvedAt: number;
    readonly recordedAt: number;
  }) => Promise<NodeLocalIntroductionLedgerEntry>;
  readonly prune: (now: number) => Promise<number>;
  readonly reset: () => Promise<void>;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_ENCODED_TRANSCRIPT_CHARS = Math.ceil((LTI_MAX_TRANSCRIPT_BYTES * 4) / 3);
const MAX_LEDGER_BYTES = 512 * 1_024;
const TOP_LEVEL_KEYS = new Set(["version", "revision", "entries"]);
const ENTRY_KEYS = new Set([
  "introductionId",
  "requestDigest",
  "approvalTbs",
  "approvalSignature",
  "approvedAt",
  "recordedAt",
]);

function collectForwardFields(
  value: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
): Readonly<Record<string, unknown>> | undefined {
  const forward = Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key)));
  return Object.keys(forward).length === 0 ? undefined : forward;
}

function timestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function decodeFixed(value: string, bytes: number): Uint8Array {
  if (!BASE64URL.test(value)) return ledgerError("local_introduction_ledger_corrupt");
  const decoded = Uint8Array.from(Buffer.from(value, "base64url"));
  if (decoded.byteLength !== bytes || Buffer.from(decoded).toString("base64url") !== value) {
    return ledgerError("local_introduction_ledger_corrupt");
  }
  return decoded;
}

function decodeApproval(value: string): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ENCODED_TRANSCRIPT_CHARS ||
    !BASE64URL.test(value)
  ) {
    return ledgerError("local_introduction_ledger_corrupt");
  }
  const decoded = Uint8Array.from(Buffer.from(value, "base64url"));
  if (decoded.byteLength === 0 || decoded.byteLength > LTI_MAX_TRANSCRIPT_BYTES) {
    return ledgerError("local_introduction_ledger_corrupt");
  }
  return decoded;
}

function parseEntry(value: unknown): NodeLocalIntroductionLedgerEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ledgerError("local_introduction_ledger_corrupt");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.introductionId !== "string" ||
    typeof candidate.requestDigest !== "string" ||
    typeof candidate.approvalTbs !== "string" ||
    typeof candidate.approvalSignature !== "string" ||
    !timestamp(candidate.approvedAt) ||
    !timestamp(candidate.recordedAt)
  ) {
    return ledgerError("local_introduction_ledger_corrupt");
  }
  decodeFixed(candidate.introductionId, LTI_ID_BYTES);
  decodeFixed(candidate.requestDigest, LTI_DIGEST_BYTES);
  decodeApproval(candidate.approvalTbs);
  decodeFixed(candidate.approvalSignature, 64);
  const forwardFields = collectForwardFields(candidate, ENTRY_KEYS);
  return {
    introductionId: candidate.introductionId,
    requestDigest: candidate.requestDigest,
    approvalTbs: candidate.approvalTbs,
    approvalSignature: candidate.approvalSignature,
    approvedAt: candidate.approvedAt,
    recordedAt: candidate.recordedAt,
    ...(forwardFields === undefined ? {} : { forwardFields }),
  };
}

function parseFile(value: unknown): StoredLedger {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ledgerError("local_introduction_ledger_corrupt");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !timestamp(candidate.revision) ||
    !Array.isArray(candidate.entries) ||
    candidate.entries.length > LTI_LEDGER_MAX_ENTRIES
  ) {
    return ledgerError("local_introduction_ledger_corrupt");
  }
  const entries = candidate.entries.map(parseEntry);
  if (new Set(entries.map((entry) => entry.introductionId)).size !== entries.length) {
    return ledgerError("local_introduction_ledger_corrupt");
  }
  return {
    record: { version: 1, revision: candidate.revision, entries },
    forwardFields: collectForwardFields(candidate, TOP_LEVEL_KEYS) ?? {},
  };
}

function encodeEntry(entry: NodeLocalIntroductionLedgerEntry): unknown {
  return {
    ...entry.forwardFields,
    introductionId: entry.introductionId,
    requestDigest: entry.requestDigest,
    approvalTbs: entry.approvalTbs,
    approvalSignature: entry.approvalSignature,
    approvedAt: entry.approvedAt,
    recordedAt: entry.recordedAt,
  };
}

function encodeFile(value: StoredLedger): unknown {
  return {
    ...value.forwardFields,
    ...value.record,
    entries: value.record.entries.map(encodeEntry),
  };
}

function initialRecord(): LedgerRecord {
  return { version: 1, revision: 0, entries: [] };
}

function encodeFixed(value: Uint8Array, bytes: number): string {
  if (!(value instanceof Uint8Array) || value.byteLength !== bytes) {
    return ledgerError("local_introduction_ledger_operation_failed");
  }
  return Buffer.from(value).toString("base64url");
}

function encodeApproval(value: Uint8Array): string {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > LTI_MAX_TRANSCRIPT_BYTES
  ) {
    return ledgerError("local_introduction_ledger_operation_failed");
  }
  return Buffer.from(value).toString("base64url");
}

function currentEntries(
  entries: readonly NodeLocalIntroductionLedgerEntry[],
  now: number,
): readonly NodeLocalIntroductionLedgerEntry[] {
  // A wall-clock rollback must not erase replay evidence. A future timestamp is
  // retained until time catches up; only an entry definitely older than the
  // retention window is eligible for removal.
  return entries.filter((entry) => now - entry.recordedAt <= LTI_LEDGER_RETENTION_MS);
}

const FAILURES: Readonly<Record<ProtectedStateFileFailure, NodeLocalIntroductionLedgerErrorCode>> =
  {
    unavailable: "local_introduction_ledger_unavailable",
    locked: "local_introduction_ledger_locked",
    corrupt: "local_introduction_ledger_corrupt",
    operation_failed: "local_introduction_ledger_operation_failed",
  };

export async function makeNodeLocalIntroductionLedger(options: {
  readonly path: string;
}): Promise<NodeLocalIntroductionLedger> {
  const file = await openProtectedStateFile({
    path: options.path,
    maxBytes: MAX_LEDGER_BYTES,
    fail: (failure) => ledgerError(FAILURES[failure]),
  });

  const load = async (): Promise<StoredLedger> => {
    const raw = await file.readJson();
    if (raw !== null) return parseFile(raw);
    const initial = { record: initialRecord(), forwardFields: {} };
    await file.writeJson(encodeFile(initial));
    return initial;
  };

  const write = async (stored: StoredLedger): Promise<void> => {
    const parsed = parseFile(encodeFile(stored));
    await file.writeJson(encodeFile(parsed));
  };

  const get: NodeLocalIntroductionLedger["get"] = async (introductionId) => {
    const id = encodeFixed(introductionId, LTI_ID_BYTES);
    return file.withLock(async () =>
      (await load()).record.entries.find((entry) => entry.introductionId === id),
    );
  };

  const commit: NodeLocalIntroductionLedger["commit"] = async (input) => {
    const introductionId = encodeFixed(input.introductionId, LTI_ID_BYTES);
    const requestDigest = encodeFixed(input.requestDigest, LTI_DIGEST_BYTES);
    const approvalTbs = encodeApproval(input.approvalTbs);
    const approvalSignature = encodeFixed(input.approvalSignature, 64);
    if (!timestamp(input.approvedAt) || !timestamp(input.recordedAt)) {
      return ledgerError("local_introduction_ledger_operation_failed");
    }
    return file.withLock(async () => {
      const stored = await load();
      const existing = stored.record.entries.find(
        (entry) => entry.introductionId === introductionId,
      );
      if (existing !== undefined) {
        if (
          existing.requestDigest !== requestDigest ||
          existing.approvalTbs !== approvalTbs ||
          existing.approvalSignature !== approvalSignature ||
          existing.approvedAt !== input.approvedAt
        ) {
          return ledgerError("local_introduction_ledger_conflict");
        }
        return existing;
      }
      const entry: NodeLocalIntroductionLedgerEntry = {
        introductionId,
        requestDigest,
        approvalTbs,
        approvalSignature,
        approvedAt: input.approvedAt,
        recordedAt: input.recordedAt,
      };
      const retained = currentEntries(stored.record.entries, input.recordedAt)
        .toSorted((left, right) =>
          left.recordedAt === right.recordedAt
            ? left.introductionId.localeCompare(right.introductionId)
            : left.recordedAt - right.recordedAt,
        )
        .slice(-(LTI_LEDGER_MAX_ENTRIES - 1));
      const record: LedgerRecord = {
        version: 1,
        revision: stored.record.revision + 1,
        entries: [...retained, entry],
      };
      await write({ ...stored, record });
      return entry;
    });
  };

  const prune: NodeLocalIntroductionLedger["prune"] = async (now) => {
    if (!timestamp(now)) return ledgerError("local_introduction_ledger_operation_failed");
    return file.withLock(async () => {
      const stored = await load();
      const entries = currentEntries(stored.record.entries, now);
      const removed = stored.record.entries.length - entries.length;
      if (removed === 0) return 0;
      await write({
        ...stored,
        record: { ...stored.record, revision: stored.record.revision + 1, entries },
      });
      return removed;
    });
  };

  const reset: NodeLocalIntroductionLedger["reset"] = () =>
    file.withLock(async () => {
      const stored = await load();
      await write({
        ...stored,
        record: { ...initialRecord(), revision: stored.record.revision + 1 },
      });
    });

  return { get, commit, prune, reset };
}

import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { canonicalizeHubOrigin } from "@ryco/shared/nodeIdentity";

export interface PendingHubEnrollmentState {
  readonly hubOrigin: string;
  readonly keySecretName: string;
  readonly pollingSecretName: string;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly pollIntervalMs: number | null;
}

export interface ActiveHubNodeState {
  readonly hubOrigin: string;
  readonly nodeId: string;
  readonly activeKeyId: string;
  readonly activeKeySecretName: string;
  readonly enrolledAt: number;
}

export interface StagedHubRotationState {
  readonly hubOrigin: string;
  readonly rotationRequestId: string;
  readonly newKeyId: string;
  readonly newKeySecretName: string;
  readonly stagedAt: number;
  readonly activatedAt: number | null;
}

export interface LocalHubIdentityState {
  readonly version: 1;
  readonly revision: number;
  readonly environmentId: string;
  readonly pendingEnrollment: PendingHubEnrollmentState | null;
  readonly activeNode: ActiveHubNodeState | null;
  readonly stagedRotation: StagedHubRotationState | null;
}

export type LocalHubIdentityStateErrorCode =
  | "identity_state_unavailable"
  | "identity_state_locked"
  | "identity_state_corrupt"
  | "identity_state_operation_failed";

export class LocalHubIdentityStateError extends Error {
  readonly code: LocalHubIdentityStateErrorCode;

  constructor(code: LocalHubIdentityStateErrorCode) {
    super("Local Hub identity state operation failed.");
    this.name = "LocalHubIdentityStateError";
    this.code = code;
  }
}

export interface LocalHubIdentityStateStore {
  readonly readOrCreate: () => Promise<LocalHubIdentityState>;
  readonly update: (
    change: (current: LocalHubIdentityState) => LocalHubIdentityState,
  ) => Promise<LocalHubIdentityState>;
}

const ENVIRONMENT_ID = /^env_[A-Za-z0-9_-]{22}$/;
const NODE_ID = /^node_[A-Za-z0-9_-]{22}$/;
const NODE_KEY_ID = /^nkey_[A-Za-z0-9_-]{22}$/;
const ROTATION_ID = /^nrot_[A-Za-z0-9_-]{22}$/;
const SECRET_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_STATE_BYTES = 16 * 1024;

function stateError(code: LocalHubIdentityStateErrorCode): never {
  throw new LocalHubIdentityStateError(code);
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isTimestamp(value);
}

function isSecretName(value: unknown): value is string {
  return typeof value === "string" && SECRET_NAME.test(value);
}

function parsePending(value: unknown): PendingHubEnrollmentState | null {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return stateError("identity_state_corrupt");
  const candidate = value as Partial<PendingHubEnrollmentState>;
  if (
    !isSecretName(candidate.keySecretName) ||
    !isSecretName(candidate.pollingSecretName) ||
    !isTimestamp(candidate.createdAt) ||
    !isNullableTimestamp(candidate.expiresAt) ||
    (candidate.pollIntervalMs !== null &&
      (!Number.isSafeInteger(candidate.pollIntervalMs) ||
        Number(candidate.pollIntervalMs) < 1_000 ||
        Number(candidate.pollIntervalMs) > 60_000))
  ) {
    return stateError("identity_state_corrupt");
  }
  let hubOrigin: string;
  try {
    hubOrigin = canonicalizeHubOrigin(candidate.hubOrigin ?? "");
  } catch {
    return stateError("identity_state_corrupt");
  }
  return {
    hubOrigin,
    keySecretName: candidate.keySecretName,
    pollingSecretName: candidate.pollingSecretName,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    pollIntervalMs: candidate.pollIntervalMs as number | null,
  };
}

function parseActive(value: unknown): ActiveHubNodeState | null {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return stateError("identity_state_corrupt");
  const candidate = value as Partial<ActiveHubNodeState>;
  if (
    typeof candidate.nodeId !== "string" ||
    !NODE_ID.test(candidate.nodeId) ||
    typeof candidate.activeKeyId !== "string" ||
    !NODE_KEY_ID.test(candidate.activeKeyId) ||
    !isSecretName(candidate.activeKeySecretName) ||
    !isTimestamp(candidate.enrolledAt)
  ) {
    return stateError("identity_state_corrupt");
  }
  let hubOrigin: string;
  try {
    hubOrigin = canonicalizeHubOrigin(candidate.hubOrigin ?? "");
  } catch {
    return stateError("identity_state_corrupt");
  }
  return {
    hubOrigin,
    nodeId: candidate.nodeId,
    activeKeyId: candidate.activeKeyId,
    activeKeySecretName: candidate.activeKeySecretName,
    enrolledAt: candidate.enrolledAt,
  };
}

function parseRotation(value: unknown): StagedHubRotationState | null {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return stateError("identity_state_corrupt");
  const candidate = value as Partial<StagedHubRotationState>;
  if (
    typeof candidate.rotationRequestId !== "string" ||
    !ROTATION_ID.test(candidate.rotationRequestId) ||
    typeof candidate.newKeyId !== "string" ||
    !NODE_KEY_ID.test(candidate.newKeyId) ||
    !isSecretName(candidate.newKeySecretName) ||
    !isTimestamp(candidate.stagedAt) ||
    !isNullableTimestamp(candidate.activatedAt)
  ) {
    return stateError("identity_state_corrupt");
  }
  let hubOrigin: string;
  try {
    hubOrigin = canonicalizeHubOrigin(candidate.hubOrigin ?? "");
  } catch {
    return stateError("identity_state_corrupt");
  }
  return {
    hubOrigin,
    rotationRequestId: candidate.rotationRequestId,
    newKeyId: candidate.newKeyId,
    newKeySecretName: candidate.newKeySecretName,
    stagedAt: candidate.stagedAt,
    activatedAt: candidate.activatedAt,
  };
}

function parseState(value: unknown): LocalHubIdentityState {
  if (typeof value !== "object" || value === null) return stateError("identity_state_corrupt");
  const candidate = value as Partial<LocalHubIdentityState>;
  if (
    candidate.version !== 1 ||
    !Number.isSafeInteger(candidate.revision) ||
    Number(candidate.revision) < 0 ||
    typeof candidate.environmentId !== "string" ||
    !ENVIRONMENT_ID.test(candidate.environmentId)
  ) {
    return stateError("identity_state_corrupt");
  }
  const state: LocalHubIdentityState = {
    version: 1,
    revision: candidate.revision as number,
    environmentId: candidate.environmentId,
    pendingEnrollment: parsePending(candidate.pendingEnrollment),
    activeNode: parseActive(candidate.activeNode),
    stagedRotation: parseRotation(candidate.stagedRotation),
  };
  if (state.pendingEnrollment !== null && state.activeNode !== null) {
    return stateError("identity_state_corrupt");
  }
  return state;
}

function makeInitialState(): LocalHubIdentityState {
  return {
    version: 1,
    revision: 0,
    environmentId: `env_${randomBytes(16).toString("base64url")}`,
    pendingEnrollment: null,
    activeNode: null,
    stagedRotation: null,
  };
}

async function readState(path: string): Promise<LocalHubIdentityState | null> {
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > MAX_STATE_BYTES
    ) {
      return stateError("identity_state_corrupt");
    }
    if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600) {
      return stateError("identity_state_corrupt");
    }
    const bytes = await readFile(path);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_STATE_BYTES) {
      return stateError("identity_state_corrupt");
    }
    return parseState(JSON.parse(bytes.toString("utf8")) as unknown);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof LocalHubIdentityStateError) throw error;
    return stateError("identity_state_corrupt");
  }
}

async function writeState(path: string, state: LocalHubIdentityState): Promise<void> {
  const validated = parseState(state);
  const encoded = Buffer.from(`${JSON.stringify(validated)}\n`, "utf8");
  if (encoded.byteLength > MAX_STATE_BYTES) return stateError("identity_state_operation_failed");
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await file.writeFile(encoded);
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporaryPath, path);
    if (process.platform !== "win32") await chmod(path, 0o600);
    const directory = await open(dirname(path), constants.O_RDONLY);
    await directory.sync();
    await directory.close();
  } catch (error: unknown) {
    await file?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof LocalHubIdentityStateError) throw error;
    return stateError("identity_state_operation_failed");
  }
}

async function assertStateDirectory(path: string, requireSecureMode: boolean): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return stateError("identity_state_unavailable");
    }
    if (process.platform !== "win32") {
      const uid = process.getuid?.();
      if (
        uid === undefined ||
        stat.uid !== uid ||
        (requireSecureMode && (stat.mode & 0o777) !== 0o700)
      ) {
        return stateError("identity_state_unavailable");
      }
    }
  } catch (error: unknown) {
    if (error instanceof LocalHubIdentityStateError) throw error;
    return stateError("identity_state_unavailable");
  }
}

export async function makeLocalHubIdentityStateStore(
  statePath: string,
): Promise<LocalHubIdentityStateStore> {
  const directory = dirname(statePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertStateDirectory(directory, false);
  if (process.platform !== "win32") await chmod(directory, 0o700);
  await assertStateDirectory(directory, true);
  const lockPath = `${statePath}.lock`;

  const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    let lock;
    try {
      lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return stateError("identity_state_locked");
      }
      return stateError("identity_state_unavailable");
    }
    try {
      await lock.writeFile(`${process.pid}\n`);
      await lock.sync();
      return await operation();
    } finally {
      await lock.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  };

  const readOrCreate = (): Promise<LocalHubIdentityState> =>
    withLock(async () => {
      const existing = await readState(statePath);
      if (existing !== null) return existing;
      const initial = makeInitialState();
      await writeState(statePath, initial);
      return initial;
    });

  const update: LocalHubIdentityStateStore["update"] = (change) =>
    withLock(async () => {
      const current = (await readState(statePath)) ?? makeInitialState();
      const proposed = parseState(change(current));
      if (
        proposed.environmentId !== current.environmentId ||
        proposed.revision !== current.revision + 1
      ) {
        return stateError("identity_state_operation_failed");
      }
      await writeState(statePath, proposed);
      return proposed;
    });

  return { readOrCreate, update };
}

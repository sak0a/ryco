import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { canonicalizeHubOrigin } from "@ryco/shared/nodeIdentity";

export interface PendingHubEnrollmentState {
  readonly hubOrigin: string;
  readonly keySecretName: string;
  readonly pollingSecretName: string;
  /**
   * The short human code the service issued for this ceremony.
   *
   * Bounded non-bearer routing metadata: it identifies which pending request an
   * approver is looking at and proves nothing on its own. The polling secret,
   * which is a bearer value, stays in the protected store.
   *
   * Null until the start response arrives, and null for records written before
   * this field existed. A ceremony whose code is unknown is still pollable — it
   * simply cannot be re-displayed, so a caller must treat null as "unreadable"
   * rather than as a corrupt state.
   */
  readonly deviceCode: string | null;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly pollIntervalMs: number | null;
  readonly cleanupRequested: boolean;
}

export interface ActiveHubNodeState {
  readonly hubOrigin: string;
  readonly nodeId: string;
  readonly activeKeyId: string;
  readonly activeKeySecretName: string;
  readonly cleanupPollingSecretName: string | null;
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

/**
 * A leave that has been committed to but not finished.
 *
 * Erasing an identity spans two stores, and a crash between them would either
 * orphan protected secrets or leave state pointing at keys that are already
 * gone. Recording the intent — and every secret name to erase — before touching
 * either lets the next start finish the job. Mirrors the `cleanupRequested`
 * marker the pending-enrollment teardown already uses, hoisted to the top level
 * because a leave spans the active node, a pending ceremony, and a staged
 * rotation at once.
 */
export interface PendingHubTeardownState {
  readonly secretNames: ReadonlyArray<string>;
  readonly requestedAt: number;
}

export interface LocalHubIdentityState {
  readonly version: 1;
  readonly revision: number;
  readonly environmentId: string;
  readonly pendingEnrollment: PendingHubEnrollmentState | null;
  readonly activeNode: ActiveHubNodeState | null;
  readonly stagedRotation: StagedHubRotationState | null;
  readonly pendingTeardown: PendingHubTeardownState | null;
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
  /** Discard the identity entirely and mint a fresh `EnvironmentId`. */
  readonly reset: () => Promise<LocalHubIdentityState>;
}

const ENVIRONMENT_ID = /^env_[A-Za-z0-9_-]{22}$/;
const NODE_ID = /^node_[A-Za-z0-9_-]{22,43}$/;
const NODE_KEY_ID = /^nkey_[A-Za-z0-9_-]{22}$/;
const ROTATION_ID = /^nrot_[A-Za-z0-9_-]{22}$/;
const SECRET_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/;
/**
 * Deliberately looser than the wire-format check in `HubEnrollmentClient`. This
 * bounds charset and length so a state file cannot smuggle an unbounded or
 * injectable value; it does not pin the service's code format, so a service that
 * changes it cannot retroactively corrupt an existing state file.
 */
const DEVICE_CODE = /^[A-Z0-9-]{4,32}$/;
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

function isNullableDeviceCode(value: unknown): value is string | null {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && DEVICE_CODE.test(value);
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
        Number(candidate.pollIntervalMs) > 60_000)) ||
    (candidate.cleanupRequested !== undefined && typeof candidate.cleanupRequested !== "boolean") ||
    !isNullableDeviceCode(candidate.deviceCode)
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
    // Absent on records written before this field existed. Those ceremonies stay
    // pollable; they just cannot be re-displayed.
    deviceCode: candidate.deviceCode ?? null,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    pollIntervalMs: candidate.pollIntervalMs as number | null,
    cleanupRequested: candidate.cleanupRequested ?? false,
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
    (candidate.cleanupPollingSecretName !== undefined &&
      candidate.cleanupPollingSecretName !== null &&
      !isSecretName(candidate.cleanupPollingSecretName)) ||
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
    cleanupPollingSecretName: candidate.cleanupPollingSecretName ?? null,
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

const MAX_TEARDOWN_SECRETS = 8;

function parseTeardown(value: unknown): PendingHubTeardownState | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return stateError("identity_state_corrupt");
  const candidate = value as Partial<PendingHubTeardownState>;
  if (
    !Array.isArray(candidate.secretNames) ||
    candidate.secretNames.length > MAX_TEARDOWN_SECRETS ||
    !candidate.secretNames.every((name) => isSecretName(name)) ||
    !isTimestamp(candidate.requestedAt)
  ) {
    return stateError("identity_state_corrupt");
  }
  return { secretNames: [...candidate.secretNames], requestedAt: candidate.requestedAt };
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
    pendingTeardown: parseTeardown(candidate.pendingTeardown),
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
    pendingTeardown: null,
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
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
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

  const reclaimAbandonedLock = async (): Promise<boolean> => {
    let initial;
    try {
      initial = await lstat(lockPath);
      if (
        !initial.isFile() ||
        initial.isSymbolicLink() ||
        initial.nlink !== 1 ||
        initial.size < 2 ||
        initial.size > 32 ||
        (process.platform !== "win32" && (initial.mode & 0o777) !== 0o600)
      ) {
        return false;
      }
      const rawPid = (await readFile(lockPath, "utf8")).trim();
      if (!/^[1-9][0-9]{0,19}$/.test(rawPid)) return false;
      const pid = Number(rawPid);
      if (!Number.isSafeInteger(pid)) return false;
      try {
        process.kill(pid, 0);
        return false;
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") return false;
      }
      const current = await lstat(lockPath);
      if (current.dev !== initial.dev || current.ino !== initial.ino) return false;
      await rm(lockPath);
      return true;
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  };

  const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    let lock;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        lock = await open(
          lockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600,
        );
        break;
      } catch (error: unknown) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          attempt !== 0 ||
          !(await reclaimAbandonedLock())
        ) {
          return stateError(
            (error as NodeJS.ErrnoException).code === "EEXIST"
              ? "identity_state_locked"
              : "identity_state_unavailable",
          );
        }
      }
    }
    if (lock === undefined) return stateError("identity_state_locked");
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
      const current = await readState(statePath);
      if (current === null) return stateError("identity_state_operation_failed");
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

  /**
   * Replace the state with a fresh identity, under the same writer lock.
   *
   * Separate from `update` on purpose: `update` forbids replacing the
   * `EnvironmentId`, which is exactly right for every ordinary mutation and
   * exactly wrong for a leave. After the signing key is erased the machine can
   * prove nothing about its former self, and reusing the identifier would
   * collide with the node record it just abandoned on the service side.
   */
  const reset: LocalHubIdentityStateStore["reset"] = () =>
    withLock(async () => {
      const fresh = makeInitialState();
      await writeState(statePath, fresh);
      return fresh;
    });

  return { readOrCreate, update, reset };
}

import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { AGENT_CONTROL_EXTERNAL_CREDENTIAL_AUDIENCE } from "@ryco/contracts";

export interface ExternalMcpRuntimeDescriptor {
  readonly version: 1;
  readonly pid: number;
  readonly instanceId: string;
  readonly mcpUrl: string;
  readonly pairingUrl: string;
  readonly startedAt: string;
}

export interface ExternalMcpCredentialFile {
  readonly version: 1;
  readonly integrationId: string;
  readonly audience: typeof AGENT_CONTROL_EXTERNAL_CREDENTIAL_AUDIENCE;
  readonly credential: string;
  readonly pairedAt: string;
}

const isPosix = process.platform !== "win32";
const privateRoot = (stateDir: string) => path.join(stateDir, "external-mcp");
export const externalRuntimePath = (stateDir: string) =>
  path.join(privateRoot(stateDir), "runtime.json");
const credentialRoot = (stateDir: string) => path.join(privateRoot(stateDir), "credentials");
const credentialPath = (stateDir: string, integrationId: string) =>
  path.join(
    credentialRoot(stateDir),
    `${createHash("sha256").update(integrationId, "utf8").digest("hex")}.json`,
  );

const assertPrivate = async (target: string, expectedMode: number, kind: "file" | "directory") => {
  const stat = await lstat(target);
  if ((kind === "file" && !stat.isFile()) || (kind === "directory" && !stat.isDirectory())) {
    throw new Error(`Unsafe external MCP ${kind}`);
  }
  if (isPosix) {
    if ((stat.mode & 0o777) !== expectedMode) throw new Error(`Unsafe external MCP permissions`);
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error("Unsafe external MCP ownership");
    }
  }
};

const ensurePrivateDirectory = async (directory: string) => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (isPosix) await chmod(directory, 0o700);
  await assertPrivate(directory, 0o700, "directory");
};

const writePrivateJson = async (target: string, value: unknown) => {
  await ensurePrivateDirectory(path.dirname(target));
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertPrivate(temporary, 0o600, "file");
  await rename(temporary, target);
  if (isPosix) await chmod(target, 0o600);
  await assertPrivate(target, 0o600, "file");
};

const loopbackUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

export const writeExternalRuntimeDescriptor = async (
  stateDir: string,
  descriptor: ExternalMcpRuntimeDescriptor,
) => writePrivateJson(externalRuntimePath(stateDir), descriptor);

export const clearExternalRuntimeDescriptor = async (stateDir: string) =>
  rm(externalRuntimePath(stateDir), { force: true });

const decodeRuntime = (value: unknown): ExternalMcpRuntimeDescriptor | null => {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Partial<ExternalMcpRuntimeDescriptor>;
  return record.version === 1 &&
    Number.isInteger(record.pid) &&
    typeof record.instanceId === "string" &&
    loopbackUrl(record.mcpUrl) &&
    loopbackUrl(record.pairingUrl) &&
    typeof record.startedAt === "string"
    ? (record as ExternalMcpRuntimeDescriptor)
    : null;
};

export const selectSingleExternalRuntime = (
  candidates: ReadonlyArray<ExternalMcpRuntimeDescriptor>,
): ExternalMcpRuntimeDescriptor => {
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? "No local Ryco external MCP runtime was found"
        : "Multiple local Ryco external MCP runtimes were found",
    );
  }
  return candidates[0]!;
};

export const discoverExternalRuntime = async (
  stateDirs: ReadonlyArray<string>,
): Promise<ExternalMcpRuntimeDescriptor> => {
  const found: ExternalMcpRuntimeDescriptor[] = [];
  for (const stateDir of [...new Set(stateDirs)]) {
    const file = externalRuntimePath(stateDir);
    try {
      await assertPrivate(privateRoot(stateDir), 0o700, "directory");
      await assertPrivate(file, 0o600, "file");
      const decoded = decodeRuntime(JSON.parse(await readFile(file, "utf8")));
      if (decoded === null) continue;
      process.kill(decoded.pid, 0);
      found.push(decoded);
    } catch {
      // A stale, unreadable, unsafe, or malformed candidate is never guessed through.
    }
  }
  return selectSingleExternalRuntime(found);
};

export const discoverExternalRuntimeWithRetries = async (
  stateDirs: ReadonlyArray<string>,
  options: { readonly attempts?: number; readonly delayMs?: number } = {},
) => {
  const attempts = Math.min(Math.max(options.attempts ?? 5, 1), 10);
  const delayMs = Math.min(Math.max(options.delayMs ?? 100, 0), 1_000);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await discoverExternalRuntime(stateDirs);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Ryco discovery failed");
};

export const selectSingleExternalCredential = (
  candidates: ReadonlyArray<ExternalMcpCredentialFile>,
): ExternalMcpCredentialFile => {
  if (candidates.length !== 1) throw new Error("External MCP credential selection is ambiguous");
  return candidates[0]!;
};

export const writeExternalCredentialFile = async (
  stateDir: string,
  credential: ExternalMcpCredentialFile,
) => {
  const target = credentialPath(stateDir, credential.integrationId);
  try {
    await assertPrivate(target, 0o600, "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writePrivateJson(target, credential);
};

export const removeExternalCredentialFile = async (stateDir: string, integrationId: string) =>
  rm(credentialPath(stateDir, integrationId), { force: true });

export const readExternalCredentialFile = async (
  stateDir: string,
  integrationId: string,
): Promise<ExternalMcpCredentialFile> => {
  const root = credentialRoot(stateDir);
  const target = credentialPath(stateDir, integrationId);
  await assertPrivate(root, 0o700, "directory");
  await assertPrivate(target, 0o600, "file");
  const value = JSON.parse(await readFile(target, "utf8")) as Partial<ExternalMcpCredentialFile>;
  if (
    value.version !== 1 ||
    value.integrationId !== integrationId ||
    value.audience !== AGENT_CONTROL_EXTERNAL_CREDENTIAL_AUDIENCE ||
    typeof value.credential !== "string" ||
    !value.credential.startsWith("rycoext_") ||
    typeof value.pairedAt !== "string"
  ) {
    throw new Error("External MCP credential file is invalid");
  }
  return selectSingleExternalCredential([value as ExternalMcpCredentialFile]);
};

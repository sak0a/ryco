import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

export class GuardedJsonDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardedJsonDocumentError";
  }
}

export interface GuardedJsonDocument {
  readonly filePath: string;
  readonly exists: boolean;
  readonly fingerprint: string | null;
  readonly mode: number | null;
  readonly value: Record<string, unknown>;
  readonly indent: string;
  readonly newline: "\n" | "\r\n";
  readonly finalNewline: boolean;
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64url");
}

function formatting(
  text: string,
): Pick<GuardedJsonDocument, "indent" | "newline" | "finalNewline"> {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const indentMatch = text.match(/\r?\n([ \t]+)\S/);
  return {
    indent: indentMatch?.[1] ?? "  ",
    newline,
    finalNewline: text.endsWith("\n"),
  };
}

function parseObject(text: string, filePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new GuardedJsonDocumentError(`MCP configuration at ${filePath} is malformed JSON.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GuardedJsonDocumentError(`MCP configuration at ${filePath} is not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

async function readTextIfSafe(filePath: string): Promise<{ text: string; mode: number } | null> {
  try {
    const metadata = await lstat(filePath, { bigint: false });
    if (metadata.isSymbolicLink()) {
      throw new GuardedJsonDocumentError(`MCP configuration at ${filePath} is a symbolic link.`);
    }
    if (!metadata.isFile()) {
      throw new GuardedJsonDocumentError(`MCP configuration at ${filePath} is not a regular file.`);
    }
    return { text: await readFile(filePath, "utf8"), mode: metadata.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readGuardedJsonDocument(filePath: string): Promise<GuardedJsonDocument> {
  const current = await readTextIfSafe(filePath);
  if (!current) {
    return {
      filePath,
      exists: false,
      fingerprint: null,
      mode: null,
      value: {},
      indent: "  ",
      newline: "\n",
      finalNewline: true,
    };
  }
  return {
    filePath,
    exists: true,
    fingerprint: fingerprint(current.text),
    mode: current.mode,
    value: parseObject(current.text, filePath),
    ...formatting(current.text),
  };
}

async function assertUnchanged(snapshot: GuardedJsonDocument): Promise<void> {
  const current = await readTextIfSafe(snapshot.filePath);
  const currentFingerprint = current ? fingerprint(current.text) : null;
  if (currentFingerprint !== snapshot.fingerprint) {
    throw new GuardedJsonDocumentError(
      `MCP configuration at ${snapshot.filePath} changed before Ryco could save it.`,
    );
  }
}

export async function writeGuardedJsonDocument(
  snapshot: GuardedJsonDocument,
  value: Record<string, unknown>,
): Promise<GuardedJsonDocument> {
  await assertUnchanged(snapshot);
  const serialized = JSON.stringify(value, null, snapshot.indent).replaceAll(
    "\n",
    snapshot.newline,
  );
  const text = `${serialized}${snapshot.finalNewline ? snapshot.newline : ""}`;
  const directory = path.dirname(snapshot.filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(snapshot.filePath)}.ryco-${randomUUID()}`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporaryPath, "wx", snapshot.mode ?? 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await assertUnchanged(snapshot);
    await rename(temporaryPath, snapshot.filePath);
    const written = await readGuardedJsonDocument(snapshot.filePath);
    if (written.fingerprint !== fingerprint(text)) {
      throw new GuardedJsonDocumentError(
        `MCP configuration at ${snapshot.filePath} could not be verified after saving.`,
      );
    }
    return written;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

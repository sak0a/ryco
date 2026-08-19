import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  GuardedJsonDocumentError,
  readGuardedJsonDocument,
  writeGuardedJsonDocument,
} from "./guardedJsonDocument.ts";

describe("guardedJsonDocument", () => {
  it("preserves formatting, unknown fields, and file mode", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ryco-guarded-json-"));
    const filePath = path.join(directory, "mcp.json");
    await writeFile(filePath, '{\r\n\t"unknown": true\r\n}\r\n', { mode: 0o640 });
    await chmod(filePath, 0o640);
    const snapshot = await readGuardedJsonDocument(filePath);
    await writeGuardedJsonDocument(snapshot, { ...snapshot.value, mcpServers: {} });

    const text = await readFile(filePath, "utf8");
    expect(text).toContain('\r\n\t"unknown": true');
    expect(text.endsWith("\r\n")).toBe(true);
    expect((await stat(filePath)).mode & 0o777).toBe(0o640);
  });

  it("rejects malformed documents and concurrent edits", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ryco-guarded-json-"));
    const filePath = path.join(directory, "mcp.json");
    await writeFile(filePath, "{broken");
    await expect(readGuardedJsonDocument(filePath)).rejects.toBeInstanceOf(
      GuardedJsonDocumentError,
    );

    await writeFile(filePath, '{"mcpServers":{}}\n');
    const snapshot = await readGuardedJsonDocument(filePath);
    await writeFile(filePath, '{"mcpServers":{"user-edit":{}}}\n');
    await expect(writeGuardedJsonDocument(snapshot, snapshot.value)).rejects.toThrow(
      /changed before Ryco could save/,
    );
  });

  it("refuses symbolic-link configuration targets", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ryco-guarded-json-"));
    const target = path.join(directory, "target.json");
    const link = path.join(directory, "mcp.json");
    await writeFile(target, "{}\n");
    await symlink(target, link);
    await expect(readGuardedJsonDocument(link)).rejects.toThrow(/symbolic link/);
  });
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyShellEnvironmentCache,
  createShellEnvironmentCacheRecord,
  readShellEnvironmentCache,
  writeShellEnvironmentCache,
} from "./shellEnvironmentCache.ts";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempPath(fileName: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-shell-env-cache-test-"));
  tempDirectories.push(directory);
  return path.join(directory, fileName);
}

describe("shellEnvironmentCache", () => {
  it("writes and reads a valid cache record", () => {
    const cachePath = makeTempPath("shell-env.json");
    const record = createShellEnvironmentCacheRecord({
      env: {
        SHELL: "/bin/zsh",
        PATH: "/opt/homebrew/bin:/usr/bin",
        SSH_AUTH_SOCK: "/tmp/socket",
      },
      platform: "darwin",
      now: new Date("2026-05-12T00:00:00.000Z"),
    });

    writeShellEnvironmentCache(cachePath, record);

    expect(
      readShellEnvironmentCache(cachePath, {
        platform: "darwin",
        now: new Date("2026-05-12T01:00:00.000Z"),
      }),
    ).toEqual({ kind: "hit", record });
  });

  it("misses invalid and stale cache files", () => {
    const invalidPath = makeTempPath("invalid.json");
    fs.writeFileSync(invalidPath, "{", "utf8");
    expect(readShellEnvironmentCache(invalidPath)).toEqual({ kind: "miss", reason: "unreadable" });

    const stalePath = makeTempPath("stale.json");
    writeShellEnvironmentCache(
      stalePath,
      createShellEnvironmentCacheRecord({
        env: { PATH: "/bin" },
        platform: "darwin",
        now: new Date("2026-05-01T00:00:00.000Z"),
      }),
    );
    expect(
      readShellEnvironmentCache(stalePath, {
        platform: "darwin",
        now: new Date("2026-05-12T00:00:00.000Z"),
        maxAgeMs: 1000,
      }),
    ).toEqual({ kind: "miss", reason: "stale" });
  });

  it("applies cached values without overwriting existing non-PATH values", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/inherited.sock",
    };
    applyShellEnvironmentCache(env, {
      version: 1,
      capturedAt: "2026-05-12T00:00:00.000Z",
      platform: "darwin",
      shell: "/bin/zsh",
      environment: {
        PATH: "/opt/homebrew/bin:/usr/bin",
        SSH_AUTH_SOCK: "/tmp/cached.sock",
        HOMEBREW_PREFIX: "/opt/homebrew",
      },
    });

    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/inherited.sock");
    expect(env.HOMEBREW_PREFIX).toBe("/opt/homebrew");
  });
});

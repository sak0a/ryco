import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { Effect } from "effect";
import { afterEach, describe, it } from "vite-plus/test";

import {
  parseOpenCodeGoUsageRateLimits,
  probeOpenCodeGoUsageRateLimits,
  resolveOpenCodeDataDirPath,
} from "./OpenCodeGoUsage.ts";

const SAMPLE_USAGE_RESPONSE = {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-09-05T15:23:42.082Z" },
    weekly: { status: "ok", percent: 11, resetsAt: "2026-09-07T00:00:00.082Z" },
    monthly: { status: "ok", percent: 11, resetsAt: "2026-09-30T19:14:54.082Z" },
  },
};

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("resolveOpenCodeDataDirPath", () => {
  it("prefers XDG_DATA_HOME when set", () => {
    assert.equal(
      resolveOpenCodeDataDirPath({ XDG_DATA_HOME: "/data", HOME: "/home/u" }),
      NodePath.join("/data", "opencode"),
    );
  });

  it("falls back to ~/.local/share/opencode", () => {
    assert.equal(
      resolveOpenCodeDataDirPath({ HOME: "/home/u" }),
      NodePath.join("/home/u", ".local", "share", "opencode"),
    );
  });
});

describe("parseOpenCodeGoUsageRateLimits", () => {
  it("maps rolling, weekly, and monthly windows onto the contract", () => {
    assert.deepEqual(parseOpenCodeGoUsageRateLimits(SAMPLE_USAGE_RESPONSE), {
      limitId: "opencode-go",
      limitName: "OpenCode Go",
      planType: "go",
      primary: {
        usedPercent: 0,
        windowDurationMins: 300,
        resetsAt: Math.floor(Date.parse("2026-09-05T15:23:42.082Z") / 1000),
      },
      secondary: {
        usedPercent: 11,
        windowDurationMins: 7 * 24 * 60,
        resetsAt: Math.floor(Date.parse("2026-09-07T00:00:00.082Z") / 1000),
      },
      tertiary: {
        usedPercent: 11,
        windowDurationMins: 30 * 24 * 60,
        resetsAt: Math.floor(Date.parse("2026-09-30T19:14:54.082Z") / 1000),
      },
    });
  });

  it("omits resetsAt for unparseable timestamps but keeps the window", () => {
    assert.deepEqual(
      parseOpenCodeGoUsageRateLimits({
        usage: { rolling: { percent: 42, resetsAt: "not-a-date" } },
      }),
      {
        limitId: "opencode-go",
        limitName: "OpenCode Go",
        planType: "go",
        primary: { usedPercent: 42, windowDurationMins: 300 },
      },
    );
  });

  it("returns undefined when no window carries a numeric percent", () => {
    assert.equal(
      parseOpenCodeGoUsageRateLimits({ usage: { rolling: { percent: "high" } } }),
      undefined,
    );
    assert.equal(parseOpenCodeGoUsageRateLimits({}), undefined);
    assert.equal(parseOpenCodeGoUsageRateLimits(null), undefined);
  });
});

describe("probeOpenCodeGoUsageRateLimits", () => {
  it("reads the opencode-go key from auth.json and calls the usage API", async () => {
    const dataBase = await mkdtemp(NodePath.join(NodeOS.tmpdir(), "ryco-opencode-go-"));
    const dataDir = NodePath.join(dataBase, "opencode");
    await mkdir(dataDir, { recursive: true });
    temporaryDirectories.push(dataBase);
    await writeFile(
      NodePath.join(dataDir, "auth.json"),
      JSON.stringify({
        deepseek: { type: "api", key: "sk-other" },
        "opencode-go": { type: "api", key: "sk-go-key" },
      }),
    );

    const requested: Array<{ url: string; authorization: string | undefined }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requested.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization") ?? undefined,
      });
      return new Response(JSON.stringify(SAMPLE_USAGE_RESPONSE), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const rateLimits = await Effect.runPromise(
      probeOpenCodeGoUsageRateLimits({ XDG_DATA_HOME: dataBase }, fetchImpl),
    );

    assert.deepEqual(requested, [
      {
        url: "https://opencode.ai/zen/go/v1/usage",
        authorization: "Bearer sk-go-key",
      },
    ]);
    assert.equal(rateLimits?.limitId, "opencode-go");
    assert.equal(rateLimits?.primary?.usedPercent, 0);
    assert.equal(rateLimits?.tertiary?.usedPercent, 11);
  });

  it("degrades to undefined without an opencode-go key or on request failure", async () => {
    const dataBase = await mkdtemp(NodePath.join(NodeOS.tmpdir(), "ryco-opencode-go-"));
    const dataDir = NodePath.join(dataBase, "opencode");
    await mkdir(dataDir, { recursive: true });
    temporaryDirectories.push(dataBase);
    await writeFile(
      NodePath.join(dataDir, "auth.json"),
      JSON.stringify({ deepseek: { type: "api", key: "sk-other" } }),
    );

    const failingFetch = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof globalThis.fetch;

    assert.equal(
      await Effect.runPromise(
        probeOpenCodeGoUsageRateLimits({ XDG_DATA_HOME: dataBase }, failingFetch),
      ),
      undefined,
    );
    assert.equal(
      await Effect.runPromise(
        probeOpenCodeGoUsageRateLimits(
          { XDG_DATA_HOME: NodePath.join(dataBase, "missing") },
          failingFetch,
        ),
      ),
      undefined,
    );
  });
});

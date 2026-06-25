import {
  BrowserProfileId,
  BrowserSessionId,
  BrowserTabId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  type BrowserSessionSnapshot,
} from "@ryco/contracts";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { BrowserServiceShape } from "../../browser/BrowserService.ts";
import {
  BrowserRuntimeToolError,
  executeBrowserRuntimeToolCall,
  resolveProviderBrowserToolSupport,
} from "./BrowserRuntimeTool.ts";

function makeSessionSnapshot(threadId: ThreadId): BrowserSessionSnapshot {
  const now = "2026-06-24T10:00:00.000Z";
  const sessionId = BrowserSessionId.make("browser-session:test");
  const profileId = BrowserProfileId.make("browser-profile:test");
  const tabId = BrowserTabId.make("browser-tab:test");
  return {
    sessionId,
    profileId,
    threadId,
    projectId: ProjectId.make("project-1"),
    hostId: undefined,
    selectedTabId: tabId,
    tabs: [
      {
        tabId,
        sessionId,
        profileId,
        selected: true,
        crashed: false,
        navigation: {
          url: "about:blank",
          origin: null,
          loadState: "idle",
          canGoBack: false,
          canGoForward: false,
        },
        createdAt: now,
        updatedAt: now,
      },
    ],
    status: "ready",
    createdAt: now,
    updatedAt: now,
  };
}

describe("BrowserRuntimeTool", () => {
  it("reports provider browser tools as explicitly unsupported until adapter injection lands", () => {
    const codex = resolveProviderBrowserToolSupport(ProviderDriverKind.make("codex"));
    const cursor = resolveProviderBrowserToolSupport(ProviderDriverKind.make("cursor"));

    expect(codex.supported).toBe(false);
    expect(codex.reason).toContain("tool-injection");
    expect(cursor.supported).toBe(false);
    expect(cursor.reason).toContain("Cursor/ACP");
    expect(cursor.definitions).toEqual([]);
  });

  it("opens a thread-scoped browser session through the shared BrowserService executor", async () => {
    const threadId = ThreadId.make("thread-1");
    const snapshot = makeSessionSnapshot(threadId);
    const browser = {
      openSession: () => Effect.succeed(snapshot),
    } as unknown as BrowserServiceShape;

    await expect(
      Effect.runPromise(
        executeBrowserRuntimeToolCall(browser, {
          name: "browser_open",
          threadId,
          projectId: ProjectId.make("project-1"),
        }),
      ),
    ).resolves.toEqual(snapshot);
  });

  it("fails navigation without a session id before reaching BrowserService", async () => {
    const exit = await Effect.runPromise(
      Effect.exit(
        executeBrowserRuntimeToolCall({} as BrowserServiceShape, {
          name: "browser_navigate",
          threadId: ThreadId.make("thread-1"),
          url: "https://example.com/",
        }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
      expect(failure?.error).toBeInstanceOf(BrowserRuntimeToolError);
      expect(failure?.error).toMatchObject({ code: "missing_session" });
    }
  });
});

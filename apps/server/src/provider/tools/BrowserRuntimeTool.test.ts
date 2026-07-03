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
  BROWSER_RUNTIME_TOOL_DEFINITIONS,
  BrowserRuntimeToolError,
  executeBrowserRuntimeToolCall,
  isBrowserRuntimeToolName,
  parseBrowserRuntimeToolCallInput,
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
  it("reports browser tools as supported for wired providers", () => {
    const codex = resolveProviderBrowserToolSupport(ProviderDriverKind.make("codex"));
    const cursor = resolveProviderBrowserToolSupport(ProviderDriverKind.make("cursor"));
    const claude = resolveProviderBrowserToolSupport(ProviderDriverKind.make("claudeAgent"));
    const copilot = resolveProviderBrowserToolSupport(ProviderDriverKind.make("copilot"));
    const opencode = resolveProviderBrowserToolSupport(ProviderDriverKind.make("opencode"));

    expect(codex.supported).toBe(false);
    expect(codex.reason).toContain("dynamicTools");
    expect(codex.definitions).toEqual([]);
    expect(cursor.supported).toBe(true);
    expect(cursor.definitions.map((definition) => definition.name)).toEqual(
      BROWSER_RUNTIME_TOOL_DEFINITIONS.map((definition) => definition.name),
    );
    expect(claude.supported).toBe(true);
    expect(claude.definitions.map((definition) => definition.name)).toEqual(
      BROWSER_RUNTIME_TOOL_DEFINITIONS.map((definition) => definition.name),
    );
    expect(copilot.supported).toBe(true);
    expect(opencode.supported).toBe(true);
  });

  it("recognizes supported browser runtime tool names", () => {
    expect(isBrowserRuntimeToolName("browser_open")).toBe(true);
    expect(isBrowserRuntimeToolName("browser_snapshot")).toBe(true);
    expect(isBrowserRuntimeToolName("browser_unknown")).toBe(false);
  });

  it("maps Codex dynamic tool arguments into browser runtime tool input", async () => {
    const threadId = ThreadId.make("thread-1");
    const parsed = await Effect.runPromise(
      parseBrowserRuntimeToolCallInput({
        toolName: "browser_navigate",
        threadId,
        arguments: {
          sessionId: "browser-session:test",
          url: "https://example.com/",
        },
      }),
    );

    expect(parsed).toMatchObject({
      name: "browser_navigate",
      threadId,
      sessionId: BrowserSessionId.make("browser-session:test"),
      url: "https://example.com/",
    });
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

  it("executes browser_snapshot through BrowserService", async () => {
    const threadId = ThreadId.make("thread-1");
    const browser = {
      snapshotDom: () =>
        Effect.succeed({
          session: makeSessionSnapshot(threadId),
          snapshot: {
            url: "https://example.test/",
            title: "Example",
            viewport: { width: 800, height: 600 },
            tree: [],
          },
        }),
    } as unknown as BrowserServiceShape;

    const toolInput = await Effect.runPromise(
      parseBrowserRuntimeToolCallInput({
        toolName: "browser_snapshot",
        threadId,
        arguments: { sessionId: "browser-session:test" },
      }),
    );

    await expect(
      Effect.runPromise(executeBrowserRuntimeToolCall(browser, toolInput)),
    ).resolves.toMatchObject({
      snapshot: { title: "Example" },
    });
  });
});

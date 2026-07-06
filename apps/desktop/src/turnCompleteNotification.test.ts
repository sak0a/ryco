import { describe, expect, it } from "vite-plus/test";

import {
  parseTurnCompleteNotification,
  shouldShowTurnCompleteNotification,
} from "./turnCompleteNotification.ts";

describe("parseTurnCompleteNotification", () => {
  it("parses a full payload", () => {
    expect(
      parseTurnCompleteNotification({
        threadId: "thread-1",
        environmentId: "env-1",
        title: "Fix the bug",
        body: "The agent finished responding.",
      }),
    ).toEqual({
      threadId: "thread-1",
      environmentId: "env-1",
      title: "Fix the bug",
      body: "The agent finished responding.",
    });
  });

  it("omits optional fields when absent", () => {
    expect(parseTurnCompleteNotification({ threadId: "thread-1", title: "Done" })).toEqual({
      threadId: "thread-1",
      title: "Done",
    });
  });

  it("rejects payloads without a thread id or title", () => {
    expect(parseTurnCompleteNotification(null)).toBeNull();
    expect(parseTurnCompleteNotification("nope")).toBeNull();
    expect(parseTurnCompleteNotification({ title: "Done" })).toBeNull();
    expect(parseTurnCompleteNotification({ threadId: "thread-1" })).toBeNull();
    expect(parseTurnCompleteNotification({ threadId: "", title: "Done" })).toBeNull();
    expect(parseTurnCompleteNotification({ threadId: "   ", title: "Done" })).toBeNull();
    expect(parseTurnCompleteNotification({ threadId: "thread-1", title: "   " })).toBeNull();
  });

  it("truncates an oversized body", () => {
    const parsed = parseTurnCompleteNotification({
      threadId: "thread-1",
      title: "Done",
      body: "x".repeat(1000),
    });
    expect(parsed?.body?.length).toBe(240);
  });
});

describe("shouldShowTurnCompleteNotification", () => {
  it("shows only when unfocused and supported", () => {
    expect(
      shouldShowTurnCompleteNotification({ windowFocused: false, notificationsSupported: true }),
    ).toBe(true);
  });

  it("suppresses when the window is focused", () => {
    expect(
      shouldShowTurnCompleteNotification({ windowFocused: true, notificationsSupported: true }),
    ).toBe(false);
  });

  it("suppresses when notifications are unsupported", () => {
    expect(
      shouldShowTurnCompleteNotification({ windowFocused: false, notificationsSupported: false }),
    ).toBe(false);
  });
});

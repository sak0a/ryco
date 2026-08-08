import { MessageId } from "@ryco/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  applyRightPanelSessionSearch,
  clearRightPanelSessionSearch,
  copyRightPanelSessionSearch,
  readRightPanelSessionSearch,
  rememberRightPanelSessionSearch,
} from "./rightPanelSessionState";

describe("right panel session state", () => {
  beforeEach(clearRightPanelSessionSearch);

  it("keeps open state and active modes isolated by thread", () => {
    rememberRightPanelSessionSearch("thread-a", {
      workspaceOpen: "1",
      workspaceTab: "terminal",
    });
    rememberRightPanelSessionSearch("thread-b", {});

    expect(readRightPanelSessionSearch("thread-a")).toEqual({
      workspaceOpen: "1",
      workspaceTab: "terminal",
    });
    expect(readRightPanelSessionSearch("thread-b")).toEqual({});
    expect(readRightPanelSessionSearch("thread-c")).toBeUndefined();
  });

  it("remembers when a thread closes its workspace", () => {
    rememberRightPanelSessionSearch("thread-a", {
      workspaceOpen: "1",
      workspaceTab: "agents",
    });
    rememberRightPanelSessionSearch("thread-a", {});

    expect(readRightPanelSessionSearch("thread-a")).toEqual({});
  });

  it("restores only panel fields and preserves unrelated route search", () => {
    expect(
      applyRightPanelSessionSearch(
        {
          messageId: MessageId.make("message-2"),
          workspaceOpen: "1",
          workspaceTab: "agents",
        },
        { workspaceOpen: "1", workspaceTab: "files", preview: "1" },
      ),
    ).toEqual({
      messageId: MessageId.make("message-2"),
      workspaceOpen: "1",
      workspaceTab: "files",
      preview: "1",
    });
  });

  it("carries a draft workspace into its promoted server thread", () => {
    rememberRightPanelSessionSearch("draft:draft-a", {
      workspaceOpen: "1",
      workspaceTab: "terminal",
    });

    copyRightPanelSessionSearch("draft:draft-a", "env-a:thread-a");

    expect(readRightPanelSessionSearch("env-a:thread-a")).toEqual({
      workspaceOpen: "1",
      workspaceTab: "terminal",
    });
  });
});

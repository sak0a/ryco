import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AtlassianSaveProjectLinkInput } from "./atlassian.ts";
import { WS_METHODS } from "./rpc.ts";
import { StatisticsSnapshot } from "./statistics.ts";
import { WorkItemGetInput } from "./workItems.ts";

describe("WS_METHODS Atlassian and work item names", () => {
  it("keeps method names stable", () => {
    expect(WS_METHODS.atlassianListConnections).toBe("atlassian.listConnections");
    expect(WS_METHODS.atlassianStartOAuth).toBe("atlassian.startOAuth");
    expect(WS_METHODS.atlassianSaveProjectLink).toBe("atlassian.saveProjectLink");
    expect(WS_METHODS.atlassianSaveManualBitbucketToken).toBe("atlassian.saveManualBitbucketToken");
    expect(WS_METHODS.atlassianSaveManualJiraToken).toBe("atlassian.saveManualJiraToken");
    expect(WS_METHODS.sourceControlSearchRepositories).toBe("sourceControl.searchRepositories");
    expect(WS_METHODS.sourceControlListChangeRequests).toBe("sourceControl.listChangeRequests");
    expect(WS_METHODS.sourceControlAddIssueComment).toBe("sourceControl.addIssueComment");
    expect(WS_METHODS.sourceControlAddIssueCommentReaction).toBe(
      "sourceControl.addIssueCommentReaction",
    );
    expect(WS_METHODS.sourceControlAddChangeRequestComment).toBe(
      "sourceControl.addChangeRequestComment",
    );
    expect(WS_METHODS.sourceControlAddChangeRequestCommentReaction).toBe(
      "sourceControl.addChangeRequestCommentReaction",
    );
    expect(WS_METHODS.workItemsListProjects).toBe("workItems.listProjects");
    expect(WS_METHODS.workItemsList).toBe("workItems.list");
    expect(WS_METHODS.workItemsUpdate).toBe("workItems.update");
    expect(WS_METHODS.workItemsEditComment).toBe("workItems.editComment");
    expect(WS_METHODS.workItemsTransition).toBe("workItems.transition");
  });

  it("rejects payloads missing required fields", () => {
    expect(() => Schema.decodeUnknownSync(WorkItemGetInput)({ key: "" })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AtlassianSaveProjectLinkInput)({
        projectId: "project-1",
        jiraConnectionId: null,
      }),
    ).toThrow();
  });
});

describe("Statistics contract", () => {
  const minimalSnapshot = {
    generatedAt: "2026-06-10T00:00:00.000Z",
    projects: [{ id: "project-1", title: "Project One" }],
    models: [{ model: "gpt-5.4", provider: "codex" }],
    dailyBuckets: [
      {
        date: "2026-06-10",
        projectId: "project-1",
        model: "gpt-5.4",
        provider: "codex",
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 150,
        turns: 2,
        activeMs: 1000,
        toolUses: 1,
        filesChanged: 3,
        additions: 10,
        deletions: 2,
        commits: 0,
        pushes: 0,
        threadsCreated: 1,
      },
    ],
    worktrees: { created: 1, archived: 0, active: 1, openPrs: 0 },
    totals: {
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 150,
      turns: 2,
      activeMs: 1000,
      toolUses: 1,
      filesChanged: 3,
      additions: 10,
      deletions: 2,
      commits: 0,
      pushes: 0,
      threads: 1,
      projects: 1,
    },
    tokenAttribution: "per-turn-delta" as const,
  };

  it("exposes a stable method name", () => {
    expect(WS_METHODS.serverGetStatistics).toBe("server.getStatistics");
  });

  it("decodes a well-formed snapshot", () => {
    const decoded = Schema.decodeUnknownSync(StatisticsSnapshot)(minimalSnapshot);
    expect(decoded.totals.totalTokens).toBe(150);
    expect(decoded.dailyBuckets[0]?.model).toBe("gpt-5.4");
  });

  it("rejects an invalid daily bucket", () => {
    expect(() =>
      Schema.decodeUnknownSync(StatisticsSnapshot)({
        ...minimalSnapshot,
        dailyBuckets: [{ ...minimalSnapshot.dailyBuckets[0], inputTokens: "oops" }],
      }),
    ).toThrow();
  });

  it("encodes blank display strings without throwing (no RPC crash)", () => {
    // Display strings are intentionally permissive: a stray empty/legacy value
    // must not fail success-encoding and take down the whole RPC.
    const decoded = Schema.decodeUnknownSync(StatisticsSnapshot)({
      ...minimalSnapshot,
      models: [{ model: "" }],
      dailyBuckets: [{ ...minimalSnapshot.dailyBuckets[0], model: "", provider: "" }],
    });
    expect(() => Schema.encodeUnknownSync(StatisticsSnapshot)(decoded)).not.toThrow();
  });
});

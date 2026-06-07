import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AtlassianSaveProjectLinkInput } from "./atlassian.ts";
import { WS_METHODS } from "./rpc.ts";
import { WorkItemGetInput } from "./workItems.ts";

describe("WS_METHODS Atlassian and work item names", () => {
  it("keeps method names stable", () => {
    expect(WS_METHODS.atlassianListConnections).toBe("atlassian.listConnections");
    expect(WS_METHODS.atlassianStartOAuth).toBe("atlassian.startOAuth");
    expect(WS_METHODS.atlassianSaveProjectLink).toBe("atlassian.saveProjectLink");
    expect(WS_METHODS.atlassianSaveManualBitbucketToken).toBe("atlassian.saveManualBitbucketToken");
    expect(WS_METHODS.atlassianSaveManualJiraToken).toBe("atlassian.saveManualJiraToken");
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
    expect(WS_METHODS.workItemsList).toBe("workItems.list");
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

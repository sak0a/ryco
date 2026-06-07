import { DateTime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AtlassianConnectionSummary,
  AtlassianProjectLink,
  AtlassianResourceSummary,
} from "./atlassian.ts";

const now = DateTime.fromDateUnsafe(new Date("2026-05-12T12:00:00.000Z"));

describe("Atlassian contracts", () => {
  it("decodes a connected OAuth connection", () => {
    const decoded = Schema.decodeUnknownSync(AtlassianConnectionSummary)({
      connectionId: "atl-conn-1",
      kind: "oauth_3lo",
      label: "Acme Atlassian",
      status: "connected",
      products: ["jira", "bitbucket"],
      capabilities: ["jira:read", "jira:write", "bitbucket:read"],
      accountName: "Alice",
      accountEmail: "alice@example.com",
      avatarUrl: "https://avatar.example.com/a.png",
      baseUrl: "https://api.atlassian.com",
      expiresAt: now,
      lastVerifiedAt: now,
      readonly: false,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    expect(decoded.kind).toBe("oauth_3lo");
    expect(decoded.capabilities).toContain("jira:read");
  });

  it("decodes a manual Bitbucket token connection", () => {
    const decoded = Schema.decodeUnknownSync(AtlassianConnectionSummary)({
      connectionId: "atl-conn-bitbucket",
      kind: "bitbucket_token",
      label: "Bitbucket workspace token",
      status: "connected",
      products: ["bitbucket"],
      capabilities: ["bitbucket:read", "bitbucket:write"],
      accountName: "build user",
      accountEmail: "build@example.com",
      avatarUrl: null,
      baseUrl: "https://api.bitbucket.org/2.0",
      expiresAt: null,
      lastVerifiedAt: now,
      readonly: false,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    expect(decoded.products).toEqual(["bitbucket"]);
  });

  it("decodes a manual Jira token connection", () => {
    const decoded = Schema.decodeUnknownSync(AtlassianConnectionSummary)({
      connectionId: "atl-conn-jira",
      kind: "jira_token",
      label: "Jira site token",
      status: "connected",
      products: ["jira"],
      capabilities: ["jira:read", "jira:write"],
      accountName: null,
      accountEmail: "jira@example.com",
      avatarUrl: null,
      baseUrl: "https://acme.atlassian.net",
      expiresAt: null,
      lastVerifiedAt: now,
      readonly: false,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    expect(decoded.kind).toBe("jira_token");
    expect(decoded.products).toEqual(["jira"]);
  });

  it("rejects unknown products and capabilities", () => {
    expect(() =>
      Schema.decodeUnknownSync(AtlassianResourceSummary)({
        resourceId: "resource-1",
        connectionId: "atl-conn-1",
        product: "confluence",
        name: "Bad resource",
        url: "https://example.atlassian.net",
        capabilities: ["confluence:read"],
        cloudId: null,
        workspaceSlug: null,
        avatarUrl: null,
        updatedAt: now,
      }),
    ).toThrow();
  });

  it("decodes a project link with Jira keys and a Bitbucket repo locator", () => {
    const decoded = Schema.decodeUnknownSync(AtlassianProjectLink)({
      projectId: "project-1",
      jiraConnectionId: "atl-conn-jira",
      bitbucketConnectionId: "atl-conn-bitbucket",
      jiraCloudId: "cloud-123",
      jiraSiteUrl: "https://acme.atlassian.net",
      jiraProjectKeys: ["RYCO", "OPS"],
      bitbucketWorkspace: "acme",
      bitbucketRepoSlug: "ryco",
      defaultIssueTypeName: "Task",
      branchNameTemplate: "{key}-{summary}",
      commitMessageTemplate: "{key}: {summary}",
      pullRequestTitleTemplate: "{key}: {summary}",
      smartLinkingEnabled: true,
      autoAttachWorkItems: true,
      createdAt: now,
      updatedAt: now,
    });

    expect(decoded.jiraProjectKeys).toEqual(["RYCO", "OPS"]);
    expect(decoded.bitbucketRepoSlug).toBe("ryco");
  });
});

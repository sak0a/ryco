import { Option } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { ComposerSourceControlContext, ComposerWorkItemContext } from "@ryco/contracts";
import { buildChatContextAttachments } from "./chatContextAttachments";

function makeIssueContext(overrides?: {
  reference?: string;
  number?: number;
}): ComposerSourceControlContext {
  return {
    id: "ctx-issue-1",
    kind: "issue",
    provider: "github",
    reference: overrides?.reference ?? "github#42",
    detail: {
      provider: "github",
      number: (overrides?.number ?? 42) as never,
      title: "Fix login bug" as never,
      url: "https://github.com/owner/repo/issues/42" as never,
      state: "open",
      updatedAt: Option.none(),
      body: "body",
      comments: [],
      truncated: false,
    },
    fetchedAt: new Date().toISOString() as never,
    staleAfter: new Date().toISOString() as never,
  } as unknown as ComposerSourceControlContext;
}

function makeChangeRequestContext(isDraft: boolean): ComposerSourceControlContext {
  return {
    id: "ctx-pr-1",
    kind: "change-request",
    provider: "github",
    reference: "github#99",
    detail: {
      provider: "github",
      number: 99 as never,
      title: "Add dark mode" as never,
      url: "https://github.com/owner/repo/pull/99" as never,
      baseRefName: "main" as never,
      headRefName: "feat/dark-mode" as never,
      state: "open",
      updatedAt: Option.none(),
      isDraft,
      body: "body",
      comments: [],
      truncated: false,
    },
    fetchedAt: new Date().toISOString() as never,
    staleAfter: new Date().toISOString() as never,
  } as unknown as ComposerSourceControlContext;
}

function makeWorkItemContext(stateName?: string): ComposerWorkItemContext {
  return {
    id: "ctx-wi-1",
    provider: "jira",
    key: "RYC-231",
    detail: {
      provider: "jira",
      key: "RYC-231",
      title: "Attribute token spend per turn",
      url: "https://acme.atlassian.net/browse/RYC-231",
      state: "in_progress",
      ...(stateName !== undefined ? { stateName } : {}),
      assignee: null,
      updatedAt: Option.none(),
      description: "desc",
      comments: [],
      transitions: [],
      linkedChangeRequests: [],
      editableFields: [],
      activity: [],
      truncated: false,
    },
    fetchedAt: new Date().toISOString() as never,
    staleAfter: new Date().toISOString() as never,
  } as unknown as ComposerWorkItemContext;
}

describe("buildChatContextAttachments", () => {
  it("maps a same-repo issue to a #N reference", () => {
    const [attachment] = buildChatContextAttachments({
      sourceControlContexts: [makeIssueContext()],
      workItemContexts: [],
    });
    expect(attachment).toMatchObject({
      type: "context",
      kind: "issue",
      provider: "github",
      reference: "#42",
      title: "Fix login bug",
      state: "open",
      url: "https://github.com/owner/repo/issues/42",
    });
  });

  it("keeps cross-repo references as owner/repo#N", () => {
    const [attachment] = buildChatContextAttachments({
      sourceControlContexts: [makeIssueContext({ reference: "owner/other#7", number: 7 })],
      workItemContexts: [],
    });
    expect(attachment?.reference).toBe("owner/other#7");
  });

  it("marks open draft PRs as draft", () => {
    const [attachment] = buildChatContextAttachments({
      sourceControlContexts: [makeChangeRequestContext(true)],
      workItemContexts: [],
    });
    expect(attachment?.kind).toBe("change-request");
    expect(attachment?.state).toBe("draft");
  });

  it("maps work items with the Jira status name", () => {
    const [attachment] = buildChatContextAttachments({
      sourceControlContexts: [],
      workItemContexts: [makeWorkItemContext("In Progress")],
    });
    expect(attachment).toMatchObject({
      type: "context",
      kind: "work-item",
      provider: "jira",
      reference: "RYC-231",
      state: "In Progress",
    });
  });

  it("falls back to the normalized state when Jira has no status name", () => {
    const [attachment] = buildChatContextAttachments({
      sourceControlContexts: [],
      workItemContexts: [makeWorkItemContext()],
    });
    expect(attachment?.state).toBe("in_progress");
  });

  it("orders source-control attachments before work items", () => {
    const attachments = buildChatContextAttachments({
      sourceControlContexts: [makeIssueContext()],
      workItemContexts: [makeWorkItemContext()],
    });
    expect(attachments.map((a) => a.kind)).toEqual(["issue", "work-item"]);
  });
});

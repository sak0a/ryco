import "../../index.css";

import {
  applyPullRequestSnapshot,
  resetPullRequestStore,
} from "@ryco/client-runtime/state/pullRequests";
import { EnvironmentId, ThreadId, WorktreeId } from "@ryco/contracts";
import { encodePullRequestId } from "@ryco/shared/pullRequestIdentity";
import { DateTime, Option } from "effect";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ChatHeaderBar } from "./ChatHeaderBar";

describe("ChatHeaderBar", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(resetPullRequestStore);

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    document.body.innerHTML = "";
  });

  it("shows the active worktree issue number and opens the linked item dialog action", async () => {
    const onOpen = vi.fn();

    mounted = await render(
      <ChatHeaderBar
        projectName="Ryco"
        isGitRepo
        worktreeBranch="issue/112"
        worktreeTitle="Top bar issue number"
        worktreeOrigin="issue"
        worktreeIssueNumber={112}
        worktreeIssueState="open"
        sessionTitle="Implementation"
        onOpenLinkedWorktreeItem={onOpen}
      />,
    );

    await expect.element(page.getByText("Issue #112")).toBeInTheDocument();

    await page.getByRole("button", { name: "Issue #112 — Open" }).click();

    expect(onOpen).toHaveBeenCalledWith({ kind: "issue", number: 112 });
  });

  it("shows the active worktree PR number", async () => {
    mounted = await render(
      <ChatHeaderBar
        projectName="Ryco"
        isGitRepo
        worktreeBranch="pr/113"
        worktreeTitle="Top bar PR number"
        worktreeOrigin="pr"
        worktreePrNumber={113}
        worktreePrState="open"
        worktreePrIsDraft={false}
        sessionTitle="Implementation"
      />,
    );

    await expect.element(page.getByText("PR #113")).toBeInTheDocument();
  });

  it("prefers repository-aware worktree associations and opens the canonical PR", async () => {
    const environmentId = EnvironmentId.make("local");
    const worktreeId = WorktreeId.make("worktree-canonical");
    const pullRequestId = encodePullRequestId({
      environmentId,
      provider: "github",
      host: "github.com",
      repositoryPath: "ryco/app",
      number: 42,
    });
    const observedAt = DateTime.makeUnsafe("2026-08-08T12:00:00Z");
    applyPullRequestSnapshot(environmentId, {
      generation: 1,
      items: [
        {
          pullRequest: {
            identity: {
              id: pullRequestId,
              environmentId,
              provider: "github",
              host: "github.com",
              repositoryPath: "ryco/app",
              number: 42,
            },
            repository: {
              canonicalKey: "github.com/ryco/app",
              host: "github.com",
              path: "ryco/app",
              displayName: "ryco/app",
            },
            title: "Canonical inbox",
            url: "https://github.com/ryco/app/pull/42",
            state: "open",
            isDraft: false,
            assignees: [],
            baseRefName: "main",
            headRefName: "feature/inbox",
            labels: [],
            review: { disposition: "unknown", requestedReviewers: [], approvedBy: [] },
            checks: { status: "unknown", total: 0, passing: 0, failing: 0, pending: 0 },
            capabilities: {
              detail: true,
              comments: true,
              reviews: true,
              checks: true,
              commits: true,
              files: true,
              viewerIdentity: false,
            },
            freshness: {
              observedAt,
              providerUpdatedAt: Option.none(),
              refreshGeneration: 1,
            },
          },
          associations: [
            {
              pullRequestId,
              subject: { kind: "worktree", worktreeId },
              relationship: "current-branch",
              evidence: "branch-reconciliation",
              createdAt: observedAt,
              endedAt: Option.none(),
            },
            {
              pullRequestId,
              subject: { kind: "thread", threadId: ThreadId.make("thread-canonical") },
              relationship: "created",
              evidence: "structured-provider-result",
              createdAt: observedAt,
              endedAt: Option.none(),
            },
          ],
          viewState: {
            pullRequestId,
            isUnread: true,
            viewedAt: Option.none(),
            providerUpdatedAtWhenViewed: Option.none(),
          },
        },
      ],
      coverage: [],
      lastSuccessAt: Option.some(observedAt),
    });
    const onOpenPullRequest = vi.fn();

    mounted = await render(
      <ChatHeaderBar
        projectName="Ryco"
        isGitRepo
        worktreeId={worktreeId}
        worktreeBranch="feature/inbox"
        worktreeTitle="Canonical inbox"
        worktreeOrigin="manual"
        worktreePrNumber={113}
        worktreePrState="closed"
        sessionTitle="Implementation"
        onOpenPullRequest={onOpenPullRequest}
      />,
    );

    expect(document.body.textContent).toContain("PR #42");
    expect(document.body.textContent).not.toContain("PR #113");
    await page.getByRole("button", { name: "ryco/app #42 — open: Canonical inbox" }).click();
    expect(onOpenPullRequest).toHaveBeenCalledWith(pullRequestId);
  });

  it("uses deterministic issue then PR ordering when both links exist", async () => {
    mounted = await render(
      <ChatHeaderBar
        projectName="Ryco"
        isGitRepo
        worktreeBranch="feature/link-both"
        worktreeTitle="Linked issue and PR"
        worktreeOrigin="pr"
        worktreeIssueNumber={112}
        worktreeIssueState="closed"
        worktreePrNumber={113}
        worktreePrState="merged"
        sessionTitle="Implementation"
      />,
    );

    const text = document.body.textContent ?? "";
    expect(text.indexOf("Issue #112")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("PR #113")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Issue #112")).toBeLessThan(text.indexOf("PR #113"));
  });

  it("does not show a source-control identifier when the worktree is unassigned", async () => {
    mounted = await render(
      <ChatHeaderBar
        projectName="Ryco"
        isGitRepo
        worktreeBranch="feature/no-linked-item"
        worktreeTitle="No linked item"
        worktreeOrigin="manual"
        sessionTitle="Implementation"
      />,
    );

    expect(document.querySelector("[data-linked-worktree-item]")).toBeNull();
    expect(document.body.textContent).not.toContain("Issue #");
    expect(document.body.textContent).not.toContain("PR #");
  });

  it("keeps long breadcrumb labels from overlapping linked issue and PR badges", async () => {
    mounted = await render(
      <div style={{ width: "760px" }}>
        <ChatHeaderBar
          projectName="A very long project name that should truncate before the badges"
          isGitRepo
          worktreeBranch="feature/super-long-worktree-branch-name-that-keeps-going"
          worktreeTitle="Extremely long worktree title that should give space to the identifiers"
          worktreeOrigin="pr"
          worktreeIssueNumber={112}
          worktreeIssueState="open"
          worktreePrNumber={113}
          worktreePrState="open"
          sessionTitle="A long active session title that must not collide with the linked badges"
          inlineActions={<span data-testid="header-actions">Actions</span>}
        />
      </div>,
    );

    const breadcrumb = document.querySelector('nav[aria-label="Breadcrumb"]');
    const issueBadge = document.querySelector('[data-linked-worktree-item="issue"]');
    const prBadge = document.querySelector('[data-linked-worktree-item="pr"]');
    const actions = document.querySelector('[data-testid="header-actions"]');

    expect(breadcrumb).not.toBeNull();
    expect(issueBadge).not.toBeNull();
    expect(prBadge).not.toBeNull();
    expect(actions).not.toBeNull();

    const breadcrumbRect = breadcrumb!.getBoundingClientRect();
    const issueRect = issueBadge!.getBoundingClientRect();
    const prRect = prBadge!.getBoundingClientRect();
    const actionsRect = actions!.getBoundingClientRect();

    expect(breadcrumbRect.right).toBeLessThanOrEqual(issueRect.left + 0.5);
    expect(issueRect.right).toBeLessThanOrEqual(prRect.left + 0.5);
    expect(prRect.right).toBeLessThanOrEqual(actionsRect.left + 0.5);
  });
});

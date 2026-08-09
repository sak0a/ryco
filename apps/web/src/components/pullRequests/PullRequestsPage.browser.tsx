import "../../index.css";

import {
  applyPullRequestAiSnapshot,
  applyPullRequestSnapshot,
  resetPullRequestStore,
} from "@ryco/client-runtime/state/pullRequests";
import {
  EnvironmentId,
  ProviderInstanceId,
  type PullRequestAiAnalysis,
  type PullRequestDetailResult,
  type PullRequestInboxItem,
  type PullRequestInboxSnapshot,
} from "@ryco/contracts";
import { encodePullRequestId } from "@ryco/shared/pullRequestIdentity";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { DateTime, Option } from "effect";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { syncDocumentPresentationTier } from "../../lib/presentationTier";
import { parsePullRequestRouteSearch } from "../../pullRequestRouteSearch";
import { useStore } from "../../store";
import { PullRequestsPage } from "./PullRequestsPage";

const environmentId = EnvironmentId.make("environment-local");

const { detailResultRef, snapshotRef } = vi.hoisted(() => ({
  detailResultRef: { current: null as PullRequestDetailResult | null },
  snapshotRef: { current: null as PullRequestInboxSnapshot | null },
}));

vi.mock("~/environments/runtime", () => {
  const connection = {
    client: {
      pullRequests: {
        listInbox: vi.fn(async () => snapshotRef.current),
        refresh: vi.fn(async () => snapshotRef.current),
        getDetail: vi.fn(async () => detailResultRef.current),
        markViewed: vi.fn(async () => undefined),
        markUnread: vi.fn(async () => undefined),
        attachRelationship: vi.fn(async () => snapshotRef.current),
        removeExplicitRelationship: vi.fn(async () => snapshotRef.current),
      },
    },
  };
  return {
    readEnvironmentConnection: () => connection,
    requireEnvironmentConnection: () => connection,
    getPrimaryEnvironmentConnection: () => connection,
    getEnvironmentHttpBaseUrl: () => "http://localhost",
    getSavedEnvironmentRecord: () => null,
    getSavedEnvironmentRuntimeState: () => null,
    hasSavedEnvironmentRegistryHydrated: () => true,
    listSavedEnvironmentRecords: () => [],
    resetSavedEnvironmentRegistryStoreForTests: vi.fn(),
    resetSavedEnvironmentRuntimeStoreForTests: vi.fn(),
    waitForSavedEnvironmentRegistryHydration: vi.fn(async () => undefined),
    subscribeEnvironmentConnections: () => () => undefined,
    resolveEnvironmentHttpUrl: () => "http://localhost",
    useSavedEnvironmentRegistryStore: (selector: (state: { byId: object }) => unknown) =>
      selector({ byId: {} }),
    useSavedEnvironmentRuntimeStore: (selector: (state: { byId: object }) => unknown) =>
      selector({ byId: {} }),
    addSavedEnvironment: vi.fn(),
    connectPrimaryEnvironment: vi.fn(),
    connectDesktopSshEnvironment: vi.fn(),
    disconnectSavedEnvironment: vi.fn(),
    disconnectPrimaryEnvironment: vi.fn(),
    ensureEnvironmentConnectionBootstrapped: vi.fn(async () => undefined),
    reconnectSavedEnvironment: vi.fn(),
    removeSavedEnvironment: vi.fn(),
    resetEnvironmentServiceForTests: vi.fn(),
    startEnvironmentConnectionService: vi.fn(() => () => undefined),
  };
});

function makeItem(input: {
  readonly repositoryPath: string;
  readonly number: number;
  readonly title: string;
  readonly updatedAt: string;
  readonly unread?: boolean;
}): PullRequestInboxItem {
  const id = encodePullRequestId({
    environmentId,
    provider: "github",
    host: "github.com",
    repositoryPath: input.repositoryPath,
    number: input.number,
  });
  const updatedAt = DateTime.makeUnsafe(input.updatedAt);
  return {
    pullRequest: {
      identity: {
        id,
        environmentId,
        provider: "github",
        host: "github.com",
        repositoryPath: input.repositoryPath,
        number: input.number,
      },
      repository: {
        canonicalKey: `github.com/${input.repositoryPath}`,
        host: "github.com",
        path: input.repositoryPath,
        displayName: input.repositoryPath,
      },
      title: input.title,
      url: `https://github.com/${input.repositoryPath}/pull/${input.number}`,
      state: "open",
      isDraft: false,
      author: "mira",
      assignees: [],
      baseRefName: "main",
      headRefName: "feature/inbox",
      labels: [],
      review: { disposition: "review-required", requestedReviewers: ["alex"], approvedBy: [] },
      checks: { status: "passing", total: 1, passing: 1, failing: 0, pending: 0 },
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
        observedAt: updatedAt,
        providerUpdatedAt: Option.some(updatedAt),
        refreshGeneration: 1,
      },
    },
    associations: [],
    viewState: {
      pullRequestId: id,
      isUnread: input.unread ?? false,
      viewedAt: Option.none(),
      providerUpdatedAtWhenViewed: Option.none(),
    },
  };
}

function makeSnapshot() {
  const items = [
    makeItem({
      repositoryPath: "ryco/app",
      number: 42,
      title: "Build the canonical pull request inbox",
      updatedAt: "2026-08-08T12:00:00Z",
      unread: true,
    }),
    makeItem({
      repositoryPath: "ryco/server",
      number: 42,
      title: "Harden repository synchronization",
      updatedAt: "2026-08-08T11:00:00Z",
    }),
  ];
  return {
    generation: 1,
    items,
    coverage: [],
    lastSuccessAt: Option.some(DateTime.makeUnsafe("2026-08-08T12:00:00Z")),
  };
}

function makeDetailResult(item: PullRequestInboxItem): PullRequestDetailResult {
  const updatedAt = DateTime.makeUnsafe("2026-08-08T12:00:00Z");
  return {
    item,
    accessTargets: [
      {
        pullRequestId: item.pullRequest.identity.id,
        environmentId,
        cwd: "/tmp/ryco-app",
        lastVerifiedAt: updatedAt,
      },
    ],
    detail: {
      provider: "github",
      number: item.pullRequest.identity.number,
      title: item.pullRequest.title,
      url: item.pullRequest.url,
      baseRefName: "main",
      headRefName: "feature/inbox",
      state: "open",
      updatedAt: Option.some(updatedAt),
      isDraft: false,
      author: "mira",
      assignees: ["alex"],
      reviewers: ["alex", "sam"],
      reviewDisposition: "review-required",
      mergeability: "mergeable",
      labels: [{ name: "risk:medium", color: "b7791f" }],
      body: "## Why\n\nCreates a repository-aware inbox and keeps related Ryco work visible during review.",
      comments: [
        {
          id: "comment-1",
          author: "alex",
          body: "The repository identity boundary looks good. I want one more pass over refresh failures.",
          createdAt: DateTime.makeUnsafe("2026-08-08T12:30:00Z"),
          reviewState: "commented",
        },
      ],
      truncated: false,
      participants: [
        { displayName: "Alex Chen", username: "alex", role: "Reviewer", approved: false },
      ],
      commits: [
        {
          oid: "1234567890abcdef",
          shortOid: "1234567",
          messageHeadline: "Build canonical pull request inbox",
          committedDate: "2026-08-08T11:45:00Z",
          author: "mira",
        },
      ],
      additions: 248,
      deletions: 37,
      changedFiles: 2,
      files: [
        {
          path: "apps/web/src/components/pullRequests/PullRequestsPage.tsx",
          additions: 220,
          deletions: 28,
        },
        { path: "packages/contracts/src/pullRequest.ts", additions: 28, deletions: 9 },
      ],
    },
  };
}

function makeAiAnalysis(item: PullRequestInboxItem): PullRequestAiAnalysis {
  const analyzedAt = DateTime.makeUnsafe("2026-08-08T13:00:00Z");
  return {
    pullRequestId: item.pullRequest.identity.id,
    viewerKey: "viewer-a",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    promptVersion: 1,
    schemaVersion: 1,
    sourceFingerprint: "browser-ai-fingerprint",
    sourceProviderUpdatedAt: item.pullRequest.freshness.providerUpdatedAt,
    depth: "deep",
    priorityScore: 84,
    priority: "urgent",
    deterministicPriorityPoints: 44,
    modelPriorityPoints: 40,
    priorityExplanation: "The inbox architecture changes review behavior across repositories.",
    assessment: {
      pullRequestId: item.pullRequest.identity.id,
      depth: "deep",
      summary:
        "This PR introduces a canonical repository-aware inbox and integrates review state with related Ryco work. The implementation is review-ready, with refresh failure handling as the main area to verify.",
      implementationPhase: "review-ready",
      attentionReason:
        "The change replaces repository-local assumptions in the main review workflow.",
      suggestedNextAction: "Review refresh failure handling and the canonical identity join.",
      risk: "medium",
      riskEvidence: ["Persistence and cross-repository identity are changed together."],
      hotspots: [
        {
          filePath: "apps/web/src/components/pullRequests/PullRequestsPage.tsx",
          title: "Refresh failure recovery",
          explanation: "Verify partial environment failures preserve cached results.",
          risk: "medium",
        },
      ],
      riskPoints: 10,
      blockerPoints: 3,
      reviewImpactPoints: 10,
      timeSensitivityPoints: 3,
      implementationCompletenessPoints: 13,
      unresolvedDiscussionRiskPoints: 2,
      confidence: 86,
    },
    mergeReadiness: Option.some({
      score: 82,
      confidence: 88,
      insufficientEvidence: false,
      factors: [],
      appliedCaps: [],
    }),
    analyzedAt,
    expiresAt: DateTime.add(analyzedAt, { hours: 24 }),
    isStale: false,
  };
}

function makeTestRouter() {
  const rootRoute = createRootRoute();
  const pullRequestsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/pull-requests",
    validateSearch: parsePullRequestRouteSearch,
    component: function TestPullRequestsRoute() {
      return (
        <div className="fixed inset-0 flex overflow-hidden">
          <PullRequestsPage search={pullRequestsRoute.useSearch()} />
        </div>
      );
    },
  });
  return createRouter({
    routeTree: rootRoute.addChildren([pullRequestsRoute]),
    history: createMemoryHistory({ initialEntries: ["/pull-requests"] }),
  });
}

describe("PullRequestsPage", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  beforeEach(async () => {
    await page.viewport(1_280, 800);
    syncDocumentPresentationTier();
    resetPullRequestStore();
    snapshotRef.current = makeSnapshot();
    detailResultRef.current = makeDetailResult(snapshotRef.current.items[0]!);
    applyPullRequestSnapshot(environmentId, snapshotRef.current);
    useStore.setState({ activeEnvironmentId: environmentId, environmentStateById: {} });
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    resetPullRequestStore();
    detailResultRef.current = null;
    document.body.innerHTML = "";
  });

  it("renders a stable split inbox and keeps same-number repositories distinct", async () => {
    mounted = await render(<RouterProvider router={makeTestRouter() as never} />);

    await expect.element(page.getByRole("heading", { name: "Pull Requests" })).toBeVisible();
    const listbox = page.getByRole("listbox", { name: "Pull requests" });
    await expect.element(listbox.getByText("ryco/app", { exact: true })).toBeVisible();
    await expect.element(listbox.getByText("ryco/server", { exact: true })).toBeVisible();
    expect(listbox.getByText("#42", { exact: true }).elements()).toHaveLength(2);

    const list = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const detail = document.querySelector<HTMLElement>(
      "section.pull-request-pane-material:last-of-type",
    )!;
    expect(list.getBoundingClientRect().width).toBeGreaterThan(300);
    expect(detail.getBoundingClientRect().width).toBeGreaterThan(500);
    expect(getComputedStyle(detail).backdropFilter).not.toBe("none");
  });

  it("searches across repositories and exposes the keyboard search shortcut", async () => {
    mounted = await render(<RouterProvider router={makeTestRouter() as never} />);
    const search = page.getByRole("searchbox", { name: "Search pull requests" });
    await expect.element(search).toBeVisible();

    await userEvent.keyboard("/");
    expect(document.activeElement).toBe(search.element());
    await search.fill("server");
    const listbox = page.getByRole("listbox", { name: "Pull requests" });
    await expect.element(listbox.getByText("ryco/server", { exact: true })).toBeVisible();
    await expect.element(listbox.getByText("ryco/app", { exact: true })).not.toBeInTheDocument();

    await search.fill("");
    await expect.element(listbox.getByText("ryco/app", { exact: true })).toBeVisible();
  });

  it("renders the management detail workspace and switches review surfaces", async () => {
    mounted = await render(<RouterProvider router={makeTestRouter() as never} />);

    await expect
      .element(
        page.getByRole("heading", {
          level: 1,
          name: "Build the canonical pull request inbox",
        }),
      )
      .toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Review readiness" })).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "What this pull request changes" }))
      .toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Related Ryco work" })).toBeVisible();

    await page.getByRole("button", { name: /^Commits/u }).click();
    await expect.element(page.getByRole("heading", { name: "Commit ledger" })).toBeVisible();
    await expect.element(page.getByText("Build canonical pull request inbox")).toBeVisible();

    await page.getByRole("button", { name: /^Files/u }).click();
    await expect.element(page.getByRole("heading", { name: "Changed files" })).toBeVisible();
    await expect
      .element(page.getByText("packages/contracts/src/pullRequest.ts", { exact: true }))
      .toBeVisible();
  });

  it("turns Priority into a ranked inbox and keeps the AI briefing inside PR detail", async () => {
    const firstItem = snapshotRef.current!.items[0]!;
    applyPullRequestAiSnapshot(environmentId, {
      generation: 1,
      analyses: [makeAiAnalysis(firstItem)],
      currentRun: Option.none(),
      latestRun: Option.none(),
      lastSuccessAt: Option.some(DateTime.makeUnsafe("2026-08-08T13:00:00Z")),
    });
    mounted = await render(<RouterProvider router={makeTestRouter() as never} />);

    await page.getByRole("tab", { name: /Priority/u }).click();
    await expect.element(page.getByText("Priority intelligence", { exact: true })).toBeVisible();
    await expect.element(page.getByText("84", { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText("AI review briefing", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText(/introduces a canonical repository-aware inbox/u))
      .toBeVisible();
    await expect.element(page.getByText("Merge readiness", { exact: true })).toBeVisible();
    await expect.element(page.getByText("82", { exact: true })).toBeVisible();
  });
});

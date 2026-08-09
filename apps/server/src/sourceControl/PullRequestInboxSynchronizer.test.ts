import {
  EnvironmentId,
  CommandId,
  ProjectId,
  ThreadId,
  WorktreeId,
  type OrchestrationShellSnapshot,
  type PullRequestAssociation,
  type PullRequestRecord,
  type RepositoryIdentity,
} from "@ryco/contracts";
import { DateTime, Effect, Option } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { PullRequestViewerKey } from "../persistence/Services/ProjectionPullRequests.ts";
import { refreshPullRequestInbox } from "./PullRequestInboxSynchronizer.ts";

const environmentId = EnvironmentId.make("env-local");
const projectId = ProjectId.make("project-a");
const repositoryIdentity: RepositoryIdentity = {
  canonicalKey: "github.com/ryco/app",
  locator: {
    source: "git-remote",
    remoteName: "origin",
    remoteUrl: "git@github.com:ryco/app.git",
  },
  rootPath: "/tmp/app",
  displayName: "ryco/app",
  provider: "github",
  owner: "ryco",
  name: "app",
  remotes: [],
};

describe("pull request inbox synchronization", () => {
  it("deduplicates repositories and records verified legacy and branch evidence", async () => {
    const records: PullRequestRecord[] = [];
    const associations: PullRequestAssociation[] = [];
    const listChangeRequests = vi.fn(() =>
      Effect.succeed([
        {
          provider: "github" as const,
          number: 42,
          title: "Canonical inbox",
          url: "https://github.com/ryco/app/pull/42",
          baseRefName: "main",
          headRefName: "feature/inbox",
          state: "open" as const,
          updatedAt: Option.some(DateTime.makeUnsafe("2026-08-08T12:00:00Z")),
        },
      ]),
    );
    const shell = {
      projects: [
        { id: projectId, workspaceRoot: "/tmp/app", repositoryIdentity },
        {
          id: ProjectId.make("project-alias"),
          workspaceRoot: "/tmp/app-alias",
          repositoryIdentity,
        },
      ],
      worktrees: [
        {
          projectId,
          worktreeId: WorktreeId.make("worktree-a"),
          prNumber: 42,
          archivedAt: null,
          branch: "feature/inbox",
        },
      ],
      threads: [
        {
          id: ThreadId.make("thread-a"),
          projectId,
          worktreeId: WorktreeId.make("worktree-a"),
          archivedAt: null,
          branch: "feature/inbox",
        },
      ],
    } as unknown as OrchestrationShellSnapshot;

    const projection = {
      upsert: (record: PullRequestRecord) =>
        Effect.sync(() => {
          records.splice(0, records.length, record);
          return true;
        }),
      upsertAccessTarget: () => Effect.void,
      recordAssociation: (association: PullRequestAssociation) =>
        Effect.sync(() => {
          if (
            !associations.some(
              (existing) =>
                existing.pullRequestId === association.pullRequestId &&
                existing.relationship === association.relationship &&
                JSON.stringify(existing.subject) === JSON.stringify(association.subject),
            )
          ) {
            associations.push(association);
          }
        }),
      listAll: () => Effect.succeed(records),
      listAssociations: (pullRequestId: PullRequestRecord["identity"]["id"]) =>
        Effect.succeed(
          associations.filter((association) => association.pullRequestId === pullRequestId),
        ),
      endAssociation: () => Effect.void,
      listInbox: () =>
        Effect.succeed({
          generation: 1,
          items: records.map((pullRequest) => ({
            pullRequest,
            associations: associations.filter(
              (association) => association.pullRequestId === pullRequest.identity.id,
            ),
            viewState: {
              pullRequestId: pullRequest.identity.id,
              isUnread: true,
              viewedAt: Option.none(),
              providerUpdatedAtWhenViewed: Option.none(),
            },
          })),
          coverage: [],
          lastSuccessAt: Option.none(),
        }),
    };
    let commandSequence = 0;
    const serverCommandId = () => CommandId.make(`test-pr-${++commandSequence}`);
    const dispatchCommand = (
      command: Parameters<typeof refreshPullRequestInbox>[0]["dispatchCommand"] extends (
        command: infer Command,
      ) => unknown
        ? Command
        : never,
    ) => {
      switch (command.type) {
        case "pull-request.observe":
          return Effect.all([projection.upsert(command.record), projection.upsertAccessTarget()], {
            discard: true,
          });
        case "pull-request.association.record":
          return projection.recordAssociation(command.association);
        case "pull-request.association.end":
          return projection.endAssociation();
        case "pull-request.viewed":
        case "pull-request.mark-unread":
          return Effect.void;
      }
    };

    const snapshot = await Effect.runPromise(
      refreshPullRequestInbox({
        environmentId,
        projection: projection as never,
        snapshots: { getShellSnapshot: () => Effect.succeed(shell) } as never,
        sourceControl: {
          resolveHandle: () =>
            Effect.succeed({
              provider: { kind: "github", listChangeRequests },
            }),
        } as never,
        coverageByRepository: new Map(),
        viewerKey: PullRequestViewerKey.make("viewer-a"),
        dispatchCommand,
        serverCommandId,
      }),
    );

    expect(listChangeRequests).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(associations.map((association) => association.relationship)).toEqual(
      expect.arrayContaining(["inspected", "current-branch"]),
    );
    expect(snapshot.coverage).toEqual([
      expect.objectContaining({ state: "complete", fetched: 1, capped: false }),
    ]);
  });
});

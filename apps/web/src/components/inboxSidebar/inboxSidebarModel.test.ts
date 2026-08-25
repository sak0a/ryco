import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildInboxSidebarSections,
  buildPrimaryInboxSidebarEnvironment,
  type InboxSidebarEnvironment,
  type InboxSidebarFilters,
} from "./inboxSidebarModel";

const ENV_A = EnvironmentId.make("machine-a");
const ENV_B = EnvironmentId.make("machine-b");
const PROJECT_A = ProjectId.make("project-a");

function project(environmentId = ENV_A): Project {
  return {
    id: PROJECT_A,
    environmentId,
    name: "Ryco",
    cwd: "/repo/ryco",
    defaultModelSelection: null,
    scripts: [],
  };
}

function thread(id: string, overrides: Partial<SidebarThreadSummary> = {}): SidebarThreadSummary {
  return {
    id: ThreadId.make(id),
    environmentId: ENV_A,
    projectId: PROJECT_A,
    title: id,
    interactionMode: "default",
    session: null,
    createdAt: "2026-08-23T10:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-08-23T10:00:00.000Z",
    latestTurn: null,
    branch: "main",
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function environment(
  environmentId: EnvironmentId,
  overrides: Partial<InboxSidebarEnvironment> = {},
): InboxSidebarEnvironment {
  return {
    environmentId,
    label: environmentId,
    connectionState: "connected",
    stale: false,
    role: "owner",
    trust: "verified",
    deliveryUnknown: false,
    threadSettlementSupported: true,
    mutationReady: true,
    shellCurrent: true,
    ...overrides,
  };
}

const ALL_FILTERS: InboxSidebarFilters = {
  query: "",
  environmentId: null,
  status: "all",
};

describe("buildPrimaryInboxSidebarEnvironment", () => {
  it("identifies a connected primary environment as This device", () => {
    expect(
      buildPrimaryInboxSidebarEnvironment({
        environmentId: ENV_A,
        connectionState: "connected",
        hydratedFromCache: false,
        threadSettlementSupported: true,
      }),
    ).toEqual({
      environmentId: ENV_A,
      label: "This device",
      connectionState: "connected",
      stale: false,
      role: "owner",
      trust: "not-required",
      deliveryUnknown: false,
      threadSettlementSupported: true,
      mutationReady: true,
      shellCurrent: true,
    });
  });

  it("keeps an actually cached primary environment visibly stale", () => {
    expect(
      buildPrimaryInboxSidebarEnvironment({
        environmentId: ENV_A,
        connectionState: "offline",
        hydratedFromCache: true,
        threadSettlementSupported: true,
      }),
    ).toMatchObject({
      label: "This device",
      connectionState: "offline",
      stale: true,
      staleDetail: "Offline · last known",
    });
  });
});

function build(input: {
  threads: ReadonlyArray<SidebarThreadSummary>;
  environments?: ReadonlyArray<InboxSidebarEnvironment>;
  filters?: InboxSidebarFilters;
  worktrees?: ReadonlyArray<SidebarWorktreeSummary>;
}) {
  return buildInboxSidebarSections({
    projects: [project(ENV_A), project(ENV_B)],
    worktrees: input.worktrees ?? [],
    threads: input.threads,
    environments: input.environments ?? [environment(ENV_A), environment(ENV_B)],
    filters: input.filters ?? ALL_FILTERS,
  });
}

describe("buildInboxSidebarSections", () => {
  it("groups active work, required input, and recency without losing machine scope", () => {
    const sections = build({
      threads: [
        thread("working", {
          latestTurn: {
            turnId: "turn-working" as never,
            state: "running",
            requestedAt: "2026-08-23T10:00:00.000Z",
            startedAt: "2026-08-23T10:00:01.000Z",
            completedAt: null,
            assistantMessageId: null,
          },
        }),
        thread("approval", { hasPendingApprovals: true }),
        thread("recent", { environmentId: ENV_B, updatedAt: "2026-08-23T11:00:00.000Z" }),
      ],
    });

    expect(sections.map((section) => section.key)).toEqual(["active", "needs-input", "recent"]);
    expect(sections[0]?.rows[0]).toMatchObject({
      key: "machine-a:working",
      machineLabel: "machine-a",
      statusLabel: "Working",
    });
    expect(sections[1]?.rows[0]?.threadId).toBe("approval");
    expect(sections[2]?.rows[0]).toMatchObject({
      key: "machine-b:recent",
      machineLabel: "machine-b",
    });
  });

  it("demotes stale cached activity and pending input to offline Recent", () => {
    const sections = build({
      environments: [
        environment(ENV_A, {
          stale: true,
          staleDetail: "Offline · last seen 4m ago",
        }),
      ],
      threads: [thread("stale", { hasPendingUserInput: true })],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: "recent" });
    expect(sections[0]?.rows[0]).toMatchObject({
      state: "offline",
      statusLabel: "Offline · last seen 4m ago",
    });
  });

  it("keeps an online demand-released machine idle instead of calling it offline", () => {
    const sections = build({
      environments: [
        environment(ENV_A, {
          connectionState: "idle",
          stale: false,
        }),
      ],
      threads: [thread("leased down")],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.rows[0]).toMatchObject({
      state: "idle",
      statusLabel: "Idle",
    });
  });

  it("uses the existing delivery, trust, role, and provider vocabulary per row", () => {
    const sections = build({
      environments: [
        environment(ENV_A, {
          deliveryUnknown: true,
          trust: "unverified",
          role: "viewer",
        }),
      ],
      threads: [
        thread("uncertain", {
          modelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-sonnet",
          },
        }),
      ],
    });

    expect(sections[0]?.rows[0]).toMatchObject({
      state: "delivery-unknown",
      statusLabel: "Check delivery",
      trustLabel: "Not verified",
      roleLabel: "Viewer",
      providerDriver: ProviderDriverKind.make("claudeAgent"),
      providerLabel: "Claude",
    });
  });

  it("applies search, machine, and status filters deterministically", () => {
    const rows = [
      thread("older match", { updatedAt: "2026-08-23T10:00:00.000Z" }),
      thread("newer match", {
        environmentId: ENV_B,
        updatedAt: "2026-08-23T11:00:00.000Z",
      }),
      thread("working match", {
        environmentId: ENV_B,
        backgroundLiveness: "working",
        updatedAt: "2026-08-23T09:00:00.000Z",
      }),
    ];

    const recent = build({
      threads: rows,
      filters: { query: "match", environmentId: ENV_B, status: "recent" },
    });
    expect(recent.flatMap((section) => section.rows.map((row) => row.threadId))).toEqual([
      "newer match",
    ]);

    const active = build({
      threads: rows,
      filters: { query: "match", environmentId: ENV_B, status: "active" },
    });
    expect(active.flatMap((section) => section.rows.map((row) => row.threadId))).toEqual([
      "working match",
    ]);
  });

  it("uses stable scoped-key ordering when timestamps tie", () => {
    const sections = build({
      threads: [thread("z"), thread("a")],
    });
    expect(sections[0]?.rows.map((row) => row.threadId)).toEqual(["a", "z"]);
  });

  it("adds a scoped Settled shelf without changing the owning route", () => {
    const sections = build({
      threads: [
        thread("done", {
          environmentId: ENV_B,
          settledOverride: "settled",
          settledAt: "2026-08-23T12:00:00.000Z",
        }),
      ],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: "settled", title: "Settled" });
    expect(sections[0]?.rows[0]).toMatchObject({
      key: "machine-b:done",
      environmentId: ENV_B,
      settled: true,
      settlementActionEnabled: true,
      effectiveSettlementTimestamp: "2026-08-23T12:00:00.000Z",
    });
  });

  it("keeps mixed-version environments Active-only and blocks unsupported commands", () => {
    const sections = build({
      environments: [environment(ENV_A, { threadSettlementSupported: false })],
      threads: [
        thread("legacy", {
          settledOverride: "settled",
          settledAt: "2026-08-23T12:00:00.000Z",
        }),
      ],
    });

    expect(sections[0]?.key).toBe("recent");
    expect(sections[0]?.rows[0]).toMatchObject({
      settled: false,
      settlementActionEnabled: false,
      settlementDisabledReason: "Update this machine to use Settle.",
    });
  });
});

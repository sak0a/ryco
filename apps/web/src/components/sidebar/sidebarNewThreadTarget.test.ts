import { describe, expect, it } from "vitest";

import { resolveNewThreadProjectKey } from "./sidebarNewThreadTarget";

interface TestThread {
  readonly id: string;
  readonly projectKey: string;
  readonly archivedAt: string | null;
  readonly updatedAt?: string | undefined;
  readonly createdAt: string;
}

const PROJECT_A = "env-local:project-a";
const PROJECT_B = "env-local:project-b";

function thread(overrides: Partial<TestThread>): TestThread {
  return {
    id: "thread-1",
    projectKey: PROJECT_A,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function resolve(input: {
  threads: TestThread[];
  lastVisited?: Record<string, number | null>;
  orderedProjectKeys?: string[];
}) {
  return resolveNewThreadProjectKey({
    orderedProjectKeys: input.orderedProjectKeys ?? [PROJECT_A, PROJECT_B],
    threads: input.threads,
    lastVisitedAtByThreadKey: new Map(Object.entries(input.lastVisited ?? {})),
    threadKey: (candidate) => candidate.id,
    threadProjectKey: (candidate) => candidate.projectKey,
  });
}

describe("resolveNewThreadProjectKey", () => {
  it("returns null with no projects", () => {
    expect(resolve({ threads: [], orderedProjectKeys: [] })).toBeNull();
  });

  it("falls back to the first project in sidebar order with no thread history", () => {
    expect(resolve({ threads: [] })).toBe(PROJECT_A);
  });

  it("picks the project of the most recently visited thread", () => {
    const target = resolve({
      threads: [
        thread({ id: "thread-a", projectKey: PROJECT_A }),
        thread({ id: "thread-b", projectKey: PROJECT_B }),
      ],
      lastVisited: {
        "thread-a": Date.parse("2026-02-01T00:00:00.000Z"),
        "thread-b": Date.parse("2026-03-01T00:00:00.000Z"),
      },
    });

    expect(target).toBe(PROJECT_B);
  });

  it("uses updatedAt when a thread has never been visited", () => {
    const target = resolve({
      threads: [
        thread({ id: "thread-a", projectKey: PROJECT_A, updatedAt: "2026-05-01T00:00:00.000Z" }),
        thread({ id: "thread-b", projectKey: PROJECT_B, updatedAt: "2026-04-01T00:00:00.000Z" }),
      ],
    });

    expect(target).toBe(PROJECT_A);
  });

  it("ignores archived threads", () => {
    const target = resolve({
      threads: [
        thread({ id: "thread-a", projectKey: PROJECT_A, updatedAt: "2026-02-01T00:00:00.000Z" }),
        thread({
          id: "thread-b",
          projectKey: PROJECT_B,
          updatedAt: "2026-09-01T00:00:00.000Z",
          archivedAt: "2026-09-02T00:00:00.000Z",
        }),
      ],
    });

    expect(target).toBe(PROJECT_A);
  });

  it("ignores threads whose project is no longer in the sidebar", () => {
    // Removing a project leaves its threads on disk; the button must not aim
    // at a project the user can no longer see.
    const target = resolve({
      threads: [
        thread({ id: "thread-a", projectKey: PROJECT_A, updatedAt: "2026-02-01T00:00:00.000Z" }),
        thread({
          id: "thread-gone",
          projectKey: "env-local:project-removed",
          updatedAt: "2026-09-01T00:00:00.000Z",
        }),
      ],
    });

    expect(target).toBe(PROJECT_A);
  });

  it("keys projects by environment so same-id projects don't collide", () => {
    const remote = "env-remote:project-a";
    const target = resolve({
      orderedProjectKeys: [PROJECT_A, remote],
      threads: [
        thread({ id: "thread-remote", projectKey: remote, updatedAt: "2026-06-01T00:00:00.000Z" }),
      ],
    });

    expect(target).toBe(remote);
  });
});

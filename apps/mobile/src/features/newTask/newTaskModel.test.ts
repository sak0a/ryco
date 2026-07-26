import { describe, expect, it } from "vite-plus/test";

import type { Project, SidebarWorktreeSummary } from "@ryco/client-runtime/state/threads";
import { EnvironmentId, ProjectId, WorktreeId } from "@ryco/contracts";

import { deriveNewTaskDefaults, inferTaskTitle, newTaskContextLabel } from "./newTaskModel";

const readyEnvironment = {
  environmentId: EnvironmentId.make("ready"),
  label: "Studio",
  connectionState: "connected" as const,
};
const readOnlyEnvironment = {
  environmentId: EnvironmentId.make("viewer"),
  label: "Shared",
  connectionState: "read-only" as const,
};
const project = {
  environmentId: readyEnvironment.environmentId,
  id: ProjectId.make("project"),
  name: "Ryco",
  cwd: "/code/ryco",
  defaultModelSelection: null,
  scripts: [],
} as Project;
const worktree = {
  environmentId: readyEnvironment.environmentId,
  projectId: project.id,
  id: WorktreeId.make("worktree"),
  title: "Mobile",
  branch: "feat/mobile",
  archivedAt: null,
} as SidebarWorktreeSummary;

describe("New Task defaults", () => {
  it("falls back from a read-only launch node to the first mutation-ready node", () => {
    const defaults = deriveNewTaskDefaults({
      launch: { environmentId: readOnlyEnvironment.environmentId },
      environments: [readOnlyEnvironment, readyEnvironment],
      projects: [project],
      worktrees: [worktree],
    });

    expect(defaults.environment?.environmentId).toBe(readyEnvironment.environmentId);
    expect(defaults.project?.id).toBe(project.id);
    expect(defaults.worktree).toBeNull();
    expect(defaults.modelSelection).toMatchObject({ instanceId: "codex", model: "gpt-5.4" });
  });

  it("preserves an active launched project and worktree", () => {
    const defaults = deriveNewTaskDefaults({
      launch: {
        environmentId: readyEnvironment.environmentId,
        projectId: project.id,
        worktreeId: worktree.id,
      },
      environments: [readyEnvironment],
      projects: [project],
      worktrees: [worktree],
    });
    expect(defaults.project?.id).toBe(project.id);
    expect(defaults.worktree?.id).toBe(worktree.id);
  });

  it("marks the inline project prerequisite without selecting stale context", () => {
    const defaults = deriveNewTaskDefaults({
      environments: [readyEnvironment],
      projects: [],
      worktrees: [],
    });
    expect(defaults.requiresProject).toBe(true);
    expect(defaults.project).toBeNull();
  });

  it("formats compact context and bounded task titles", () => {
    expect(
      newTaskContextLabel({
        environmentLabel: "Studio",
        projectTitle: "Ryco",
        worktreeTitle: "Mobile",
      }),
    ).toBe("Studio · Ryco · Mobile");
    expect(inferTaskTitle(`  ${"a".repeat(90)}\nsecond line`)).toHaveLength(70);
    expect(inferTaskTitle("")).toBe("New task");
  });
});

import type { Project, SidebarThreadSummary } from "@ryco/client-runtime/state/threads";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveMobileNewTaskTarget, retargetNewTaskDraft } from "./newTaskController";

function project(environment: string): Project {
  return {
    environmentId: EnvironmentId.make(environment),
    id: ProjectId.make(`project-${environment}`),
    name: "Ryco",
    cwd: `/code/${environment}/ryco`,
    repositoryIdentity: {
      canonicalKey: "github.com/saka-gg/ryco",
      displayName: "saka-gg/ryco",
      name: "ryco",
      rootPath: `/code/${environment}/ryco`,
    },
    defaultModelSelection: null,
    scripts: [],
  } as unknown as Project;
}

const projects = [project("env-a"), project("env-b")];
const environments = [
  { environmentId: EnvironmentId.make("env-a"), label: "A", connectionState: "connected" },
  { environmentId: EnvironmentId.make("env-b"), label: "B", connectionState: "connected" },
] as const;
const threads = [
  {
    environmentId: EnvironmentId.make("env-b"),
    id: ThreadId.make("thread-b"),
    projectId: ProjectId.make("project-env-b"),
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:30:00.000Z",
  } as SidebarThreadSummary,
];

describe("Mobile new-task execution target", () => {
  it("uses recent eligible physical copy and honors a pre-send override", () => {
    const automatic = resolveMobileNewTaskTarget({
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
      projects,
      environments,
      threads,
    });
    expect(automatic).toMatchObject({
      status: "resolved",
      source: "recent",
      target: { environmentId: "env-b", projectId: "project-env-b" },
    });

    const overridden = resolveMobileNewTaskTarget({
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
      projects,
      environments,
      threads,
      overrideEnvironmentId: EnvironmentId.make("env-a"),
    });
    expect(overridden).toMatchObject({
      status: "resolved",
      source: "override",
      target: { environmentId: "env-a", projectId: "project-env-a" },
    });
  });

  it("preserves authored/model state byte-for-byte while retargeting", () => {
    const attachments = [{ type: "image", url: "memory://one" }] as const;
    const draft = {
      prompt: "Keep this exact draft",
      attachments,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      tokenMode: "balanced" as const,
    };
    const next = retargetNewTaskDraft(
      draft,
      EnvironmentId.make("env-b"),
      ProjectId.make("project-env-b"),
    );
    expect(next).toMatchObject({
      prompt: draft.prompt,
      modelSelection: draft.modelSelection,
      runtimeMode: draft.runtimeMode,
      interactionMode: draft.interactionMode,
      tokenMode: draft.tokenMode,
      environmentId: "env-b",
      projectId: "project-env-b",
    });
    expect(next.attachments).toBe(attachments);
  });

  it("returns the pinned no-target copy when every copy is offline", () => {
    const result = resolveMobileNewTaskTarget({
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
      projects,
      environments: environments.map((environment) =>
        Object.assign({}, environment, { connectionState: "offline" as const }),
      ),
      threads,
    });
    expect(result).toEqual({
      status: "unavailable",
      message: "No verified machine available",
      reason: "no-eligible-variant",
    });
  });
});

import { EnvironmentId, ProjectId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveWorkspaceExecutionTarget } from "./executionTarget.js";
import type { WorkspaceLogicalProject, WorkspacePhysicalProjectVariant } from "./types.js";

function variant(
  environment: string,
  overrides: Partial<WorkspacePhysicalProjectVariant> = {},
): WorkspacePhysicalProjectVariant {
  return {
    environmentId: EnvironmentId.make(environment),
    projectId: ProjectId.make(`project-${environment}`),
    physicalKey: `${environment}:/repo`,
    name: "Ryco",
    cwd: "/repo",
    repositoryIdentity: null,
    machineLabel: environment,
    online: true,
    canMutate: true,
    nativeTrust: "verified",
    effectiveRole: "operator",
    lastUsedAt: null,
    lastLiveAt: null,
    localDesktop: false,
    ...overrides,
  };
}

function project(
  variants: ReadonlyArray<WorkspacePhysicalProjectVariant>,
): WorkspaceLogicalProject {
  return { key: "repo", label: "Ryco", repositoryIdentity: null, variants, ambiguous: false };
}

describe("workspace execution target", () => {
  it("allows account-trusted native variants to execute without a manual pin", () => {
    expect(
      resolveWorkspaceExecutionTarget({
        project: project([variant("account", { nativeTrust: "account-trusted" })]),
      }),
    ).toMatchObject({ status: "resolved", target: { environmentId: "account" } });
  });

  it("ranks recent use, local Desktop, and stable environment id in order", () => {
    expect(
      resolveWorkspaceExecutionTarget({
        project: project([variant("b", { localDesktop: true }), variant("a")]),
      }),
    ).toMatchObject({
      status: "resolved",
      source: "local-desktop",
      target: { environmentId: "b" },
    });

    expect(
      resolveWorkspaceExecutionTarget({
        project: project([
          variant("a", { localDesktop: true, lastUsedAt: 1 }),
          variant("b", { lastUsedAt: 2 }),
        ]),
      }),
    ).toMatchObject({ status: "resolved", source: "recent", target: { environmentId: "b" } });

    expect(
      resolveWorkspaceExecutionTarget({ project: project([variant("b"), variant("a")]) }),
    ).toMatchObject({ status: "resolved", source: "stable", target: { environmentId: "a" } });
  });

  it("honors an eligible explicit override", () => {
    const a = variant("a", { lastUsedAt: 10 });
    const b = variant("b");
    expect(
      resolveWorkspaceExecutionTarget({
        project: project([a, b]),
        override: { environmentId: b.environmentId, projectId: b.projectId },
      }),
    ).toMatchObject({ status: "resolved", source: "override", target: { environmentId: "b" } });
  });

  it("never falls back from an unavailable or unrelated override", () => {
    const offline = variant("a", { online: false });
    const eligible = variant("b");
    expect(
      resolveWorkspaceExecutionTarget({
        project: project([offline, eligible]),
        override: { environmentId: offline.environmentId, projectId: offline.projectId },
      }),
    ).toMatchObject({ status: "unavailable", reason: "override-unavailable" });
    expect(
      resolveWorkspaceExecutionTarget({
        project: project([eligible]),
        override: {
          environmentId: EnvironmentId.make("other"),
          projectId: ProjectId.make("other"),
        },
      }),
    ).toMatchObject({ status: "unavailable", reason: "override-not-in-project" });
  });

  it("uses the pinned no-target copy when no verified mutable node is online", () => {
    const result = resolveWorkspaceExecutionTarget({
      project: project([
        variant("offline", { online: false }),
        variant("viewer", { canMutate: false, effectiveRole: "viewer" }),
        variant("unverified", { nativeTrust: "unverified" }),
      ]),
    });
    expect(result).toEqual({
      status: "unavailable",
      message: "No verified machine available",
      reason: "no-eligible-variant",
    });
  });
});

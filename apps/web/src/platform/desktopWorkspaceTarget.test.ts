import { EnvironmentId, ProjectId, type DesktopWorkspaceStateProjection } from "@ryco/contracts";
import type { Project } from "@ryco/client-runtime/state/threads";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveDesktopDefaultProjectRef,
  resolveWorkspaceDefaultProjectRef,
} from "./desktopWorkspaceTarget";

function project(environment: string): Project {
  return {
    id: ProjectId.make(`project-${environment}`),
    environmentId: EnvironmentId.make(environment),
    name: "Ryco",
    cwd: "/ryco",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
  };
}

function state(): DesktopWorkspaceStateProjection {
  return {
    status: "ready",
    accountId: "account-a",
    localEnvironmentId: EnvironmentId.make("local"),
    machines: [
      {
        environmentId: EnvironmentId.make("remote"),
        nodeId: "node_remote",
        label: "Remote",
        online: true,
        nativeTrust: "verified",
        connectionState: "connected",
        canReadMetadata: true,
        canConnect: true,
        canMutate: true,
        threadSettlementSupported: true,
        accessReasons: [],
      },
      {
        environmentId: EnvironmentId.make("local"),
        nodeId: "node_local",
        label: "Local",
        online: true,
        nativeTrust: "verified",
        connectionState: "connected",
        canReadMetadata: true,
        canConnect: true,
        canMutate: true,
        threadSettlementSupported: true,
        accessReasons: [],
      },
    ],
    snapshots: [],
    queuedEnvironmentIds: [],
    activeConnectionCount: 2,
  };
}

describe("Desktop new-work target", () => {
  it("uses the shared resolver and local tie-break", () => {
    const remote = project("remote");
    const local = project("local");
    expect(
      resolveDesktopDefaultProjectRef({
        orderedProjects: [remote, local],
        workspace: state(),
        logicalKey: () => "logical-ryco",
      }),
    ).toEqual({ environmentId: local.environmentId, projectId: local.id });
  });

  it("returns no target when every physical copy is unavailable", () => {
    const remote = project("remote");
    const unavailable = {
      ...state(),
      localEnvironmentId: null,
      machines: state().machines.map((machine) =>
        Object.assign({}, machine, {
          online: false,
          canConnect: false,
          canMutate: false,
        }),
      ),
    } satisfies DesktopWorkspaceStateProjection;
    expect(
      resolveDesktopDefaultProjectRef({
        orderedProjects: [remote],
        workspace: unavailable,
        logicalKey: () => "logical-ryco",
      }),
    ).toBeNull();
  });
});

describe("Hosted Web new-work target", () => {
  it("selects only the eligible variant and never a locked, offline, or unrelated machine", () => {
    const eligible = project("eligible");
    const locked = project("locked");
    const offline = project("offline");
    expect(
      resolveWorkspaceDefaultProjectRef({
        orderedProjects: [locked, offline, eligible],
        ready: true,
        localEnvironmentId: null,
        logicalKey: () => "logical-ryco",
        machines: [
          {
            environmentId: locked.environmentId,
            label: "Native only",
            online: true,
            canMutate: false,
            nativeTrust: "not-required",
          },
          {
            environmentId: offline.environmentId,
            label: "Offline",
            online: false,
            canMutate: false,
            nativeTrust: "not-required",
          },
          {
            environmentId: eligible.environmentId,
            label: "Browser eligible",
            online: true,
            canMutate: true,
            nativeTrust: "not-required",
          },
          {
            environmentId: EnvironmentId.make("unrelated"),
            label: "Unrelated",
            online: true,
            canMutate: true,
            nativeTrust: "not-required",
          },
        ],
      }),
    ).toEqual({ environmentId: eligible.environmentId, projectId: eligible.id });
  });
});

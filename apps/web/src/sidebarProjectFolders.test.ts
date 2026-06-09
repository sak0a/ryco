import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentId, ProjectId } from "@ryco/contracts";
import { projectFolderTreeItemId, projectTreeItemId, type UiProjectFolder } from "./uiStateStore";
import {
  buildSidebarProjectFolderTree,
  resolveSidebarProjectFolderId,
} from "./sidebarProjectFolders";
import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";

function makeFolder(
  id: string,
  projectKeys: string[],
  overrides: Partial<UiProjectFolder> = {},
): UiProjectFolder {
  return {
    id,
    name: id,
    projectKeys,
    expanded: true,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...overrides,
  };
}

function makeProject(input: {
  projectKey: string;
  memberKeys?: string[];
  name?: string;
}): SidebarProjectSnapshot {
  const memberKeys = input.memberKeys ?? [input.projectKey];
  return {
    id: input.projectKey as ProjectId,
    environmentId: "env-local" as EnvironmentId,
    name: input.name ?? input.projectKey,
    displayName: input.name ?? input.projectKey,
    cwd: `/repo/${input.projectKey}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    scripts: [],
    projectKey: input.projectKey,
    groupedProjectCount: memberKeys.length,
    environmentPresence: "local-only",
    memberProjects: memberKeys.map((memberKey, index) => ({
      id: `${input.projectKey}-${index}` as ProjectId,
      environmentId: "env-local" as EnvironmentId,
      name: `${input.projectKey}-${index}`,
      cwd: `/repo/${memberKey}`,
      repositoryIdentity: null,
      defaultModelSelection: null,
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
      scripts: [],
      physicalProjectKey: memberKey,
      environmentLabel: null,
    })),
    memberProjectRefs: [],
    remoteEnvironmentLabels: [],
  };
}

describe("buildSidebarProjectFolderTree", () => {
  it("renders projects at root when there are no folders", () => {
    const projectA = makeProject({ projectKey: "project-a" });
    const projectB = makeProject({ projectKey: "project-b" });

    const tree = buildSidebarProjectFolderTree({
      projects: [projectA, projectB],
      projectFoldersById: {},
      projectFolderOrder: [],
      projectTreeOrder: [],
      projectSortOrder: "updated_at",
    });

    expect(tree.map((row) => row.kind === "project" && row.project.projectKey)).toEqual([
      "project-a",
      "project-b",
    ]);
  });

  it("preserves empty folders", () => {
    const folder = makeFolder("folder-wordpress", []);

    const tree = buildSidebarProjectFolderTree({
      projects: [],
      projectFoldersById: { [folder.id]: folder },
      projectFolderOrder: [folder.id],
      projectTreeOrder: [],
      projectSortOrder: "updated_at",
    });

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: "folder",
      folder: { id: "folder-wordpress" },
      projects: [],
    });
  });

  it("renders foldered projects under the folder and not at root", () => {
    const folder = makeFolder("folder-wordpress", ["physical-a"]);
    const projectA = makeProject({ projectKey: "logical-a", memberKeys: ["physical-a"] });
    const projectB = makeProject({ projectKey: "logical-b", memberKeys: ["physical-b"] });

    const tree = buildSidebarProjectFolderTree({
      projects: [projectA, projectB],
      projectFoldersById: { [folder.id]: folder },
      projectFolderOrder: [folder.id],
      projectTreeOrder: [projectTreeItemId("logical-b"), projectFolderTreeItemId(folder.id)],
      projectSortOrder: "updated_at",
    });

    expect(tree.map((row) => row.kind)).toEqual(["project", "folder"]);
    expect(tree[0]).toMatchObject({ kind: "project", project: { projectKey: "logical-b" } });
    expect(tree[1]).toMatchObject({
      kind: "folder",
      projects: [{ projectKey: "logical-a" }],
    });
  });

  it("keeps grouped project snapshots atomic", () => {
    const folder = makeFolder("folder-wordpress", ["physical-a-remote"]);
    const groupedProject = makeProject({
      projectKey: "logical-a",
      memberKeys: ["physical-a-local", "physical-a-remote"],
    });

    expect(
      resolveSidebarProjectFolderId(groupedProject, { [folder.id]: folder }, [folder.id]),
    ).toBe(folder.id);

    const tree = buildSidebarProjectFolderTree({
      projects: [groupedProject],
      projectFoldersById: { [folder.id]: folder },
      projectFolderOrder: [folder.id],
      projectTreeOrder: [],
      projectSortOrder: "manual",
    });

    expect(tree).toMatchObject([
      {
        kind: "folder",
        projects: [{ projectKey: "logical-a" }],
      },
    ]);
  });

  it("uses the first folder in tree order for stale conflicting membership", () => {
    const folderA = makeFolder("folder-a", ["physical-a"]);
    const folderB = makeFolder("folder-b", ["physical-a"]);
    const projectA = makeProject({ projectKey: "logical-a", memberKeys: ["physical-a"] });

    const tree = buildSidebarProjectFolderTree({
      projects: [projectA],
      projectFoldersById: { [folderA.id]: folderA, [folderB.id]: folderB },
      projectFolderOrder: [folderB.id, folderA.id],
      projectTreeOrder: [projectFolderTreeItemId(folderA.id), projectFolderTreeItemId(folderB.id)],
      projectSortOrder: "updated_at",
    });

    expect(tree).toMatchObject([
      { kind: "folder", folder: { id: "folder-a" }, projects: [{ projectKey: "logical-a" }] },
      { kind: "folder", folder: { id: "folder-b" }, projects: [] },
    ]);
  });

  it("appends missing tree entries predictably", () => {
    const folder = makeFolder("folder-wordpress", []);
    const projectA = makeProject({ projectKey: "project-a" });

    const tree = buildSidebarProjectFolderTree({
      projects: [projectA],
      projectFoldersById: { [folder.id]: folder },
      projectFolderOrder: [folder.id],
      projectTreeOrder: [],
      projectSortOrder: "updated_at",
    });

    expect(tree.map((row) => row.itemId)).toEqual([
      projectFolderTreeItemId(folder.id),
      projectTreeItemId("project-a"),
    ]);
  });

  it("uses folder child order only in manual sort mode", () => {
    const folder = makeFolder("folder-wordpress", ["physical-b", "physical-a"]);
    const projectA = makeProject({ projectKey: "logical-a", memberKeys: ["physical-a"] });
    const projectB = makeProject({ projectKey: "logical-b", memberKeys: ["physical-b"] });

    const manualTree = buildSidebarProjectFolderTree({
      projects: [projectA, projectB],
      projectFoldersById: { [folder.id]: folder },
      projectFolderOrder: [folder.id],
      projectTreeOrder: [],
      projectSortOrder: "manual",
    });
    const timestampTree = buildSidebarProjectFolderTree({
      projects: [projectA, projectB],
      projectFoldersById: { [folder.id]: folder },
      projectFolderOrder: [folder.id],
      projectTreeOrder: [],
      projectSortOrder: "updated_at",
    });

    expect(manualTree[0]).toMatchObject({
      kind: "folder",
      projects: [{ projectKey: "logical-b" }, { projectKey: "logical-a" }],
    });
    expect(timestampTree[0]).toMatchObject({
      kind: "folder",
      projects: [{ projectKey: "logical-a" }, { projectKey: "logical-b" }],
    });
  });
});

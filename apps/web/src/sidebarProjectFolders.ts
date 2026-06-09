import type { SidebarProjectSortOrder } from "@ryco/contracts/settings";
import {
  parseProjectTreeItemId,
  projectFolderTreeItemId,
  projectTreeItemId,
  type UiProjectFolder,
  type UiProjectTreeItemId,
} from "./uiStateStore";
import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";

export type SidebarProjectTreeRow =
  | {
      kind: "folder";
      itemId: UiProjectTreeItemId;
      folder: UiProjectFolder;
      projects: SidebarProjectSnapshot[];
    }
  | {
      kind: "project";
      itemId: UiProjectTreeItemId;
      project: SidebarProjectSnapshot;
    };

export interface BuildSidebarProjectFolderTreeInput {
  projects: readonly SidebarProjectSnapshot[];
  projectFoldersById: Record<string, UiProjectFolder>;
  projectFolderOrder: readonly string[];
  projectTreeOrder: readonly UiProjectTreeItemId[];
  projectSortOrder: SidebarProjectSortOrder;
}

function orderedFolderIds(input: {
  projectFoldersById: Record<string, UiProjectFolder>;
  projectFolderOrder: readonly string[];
}): string[] {
  const result: string[] = [];
  for (const folderId of input.projectFolderOrder) {
    if (input.projectFoldersById[folderId] !== undefined && !result.includes(folderId)) {
      result.push(folderId);
    }
  }
  for (const folderId of Object.keys(input.projectFoldersById)) {
    if (!result.includes(folderId)) {
      result.push(folderId);
    }
  }
  return result;
}

export function resolveSidebarProjectFolderId(
  project: SidebarProjectSnapshot,
  foldersById: Record<string, UiProjectFolder>,
  folderOrder: readonly string[],
): string | null {
  const memberKeys = new Set(project.memberProjects.map((member) => member.physicalProjectKey));
  for (const folderId of orderedFolderIds({
    projectFoldersById: foldersById,
    projectFolderOrder: folderOrder,
  })) {
    const folder = foldersById[folderId];
    if (!folder) {
      continue;
    }
    if (folder.projectKeys.some((projectKey) => memberKeys.has(projectKey))) {
      return folderId;
    }
  }
  return null;
}

function sortFolderProjects(input: {
  folder: UiProjectFolder;
  projects: readonly SidebarProjectSnapshot[];
  projectSortOrder: SidebarProjectSortOrder;
  sourceIndexByProjectKey: ReadonlyMap<string, number>;
}): SidebarProjectSnapshot[] {
  if (input.projectSortOrder !== "manual") {
    return [...input.projects].toSorted((left, right) => {
      return (
        (input.sourceIndexByProjectKey.get(left.projectKey) ?? 0) -
        (input.sourceIndexByProjectKey.get(right.projectKey) ?? 0)
      );
    });
  }

  const projectKeyOrder = new Map(
    input.folder.projectKeys.map((projectKey, index) => [projectKey, index]),
  );
  return [...input.projects].toSorted((left, right) => {
    const leftIndex = Math.min(
      ...left.memberProjects.map(
        (member) => projectKeyOrder.get(member.physicalProjectKey) ?? Number.POSITIVE_INFINITY,
      ),
    );
    const rightIndex = Math.min(
      ...right.memberProjects.map(
        (member) => projectKeyOrder.get(member.physicalProjectKey) ?? Number.POSITIVE_INFINITY,
      ),
    );
    const byFolderOrder = leftIndex - rightIndex;
    if (Number.isFinite(byFolderOrder) && byFolderOrder !== 0) {
      return byFolderOrder;
    }
    return (
      (input.sourceIndexByProjectKey.get(left.projectKey) ?? 0) -
      (input.sourceIndexByProjectKey.get(right.projectKey) ?? 0)
    );
  });
}

export function buildSidebarProjectFolderTree(
  input: BuildSidebarProjectFolderTreeInput,
): SidebarProjectTreeRow[] {
  const folderIds = orderedFolderIds(input);
  const membershipFolderIds = [
    ...input.projectTreeOrder.flatMap((itemId) => {
      const parsed = parseProjectTreeItemId(itemId);
      return parsed?.kind === "folder" && input.projectFoldersById[parsed.folderId] !== undefined
        ? [parsed.folderId]
        : [];
    }),
    ...folderIds,
  ].filter((folderId, index, ids) => ids.indexOf(folderId) === index);
  const projectsByKey = new Map(input.projects.map((project) => [project.projectKey, project]));
  const sourceIndexByProjectKey = new Map(
    input.projects.map((project, index) => [project.projectKey, index] as const),
  );
  const projectFolderIdByKey = new Map<string, string>();
  const folderProjectsById = new Map<string, SidebarProjectSnapshot[]>();
  const rootProjects: SidebarProjectSnapshot[] = [];

  for (const project of input.projects) {
    const folderId = resolveSidebarProjectFolderId(
      project,
      input.projectFoldersById,
      membershipFolderIds,
    );
    if (!folderId) {
      rootProjects.push(project);
      continue;
    }
    projectFolderIdByKey.set(project.projectKey, folderId);
    const existing = folderProjectsById.get(folderId) ?? [];
    existing.push(project);
    folderProjectsById.set(folderId, existing);
  }

  const availableRootItemIds = new Set<UiProjectTreeItemId>([
    ...folderIds.map(projectFolderTreeItemId),
    ...rootProjects.map((project) => projectTreeItemId(project.projectKey)),
  ]);
  const seen = new Set<string>();
  const orderedItemIds: UiProjectTreeItemId[] = [];

  for (const itemId of input.projectTreeOrder) {
    if (seen.has(itemId) || !availableRootItemIds.has(itemId)) {
      continue;
    }
    const parsed = parseProjectTreeItemId(itemId);
    if (!parsed) {
      continue;
    }
    seen.add(itemId);
    orderedItemIds.push(itemId);
  }

  for (const folderId of folderIds) {
    const itemId = projectFolderTreeItemId(folderId);
    if (!seen.has(itemId)) {
      seen.add(itemId);
      orderedItemIds.push(itemId);
    }
  }
  for (const project of rootProjects) {
    const itemId = projectTreeItemId(project.projectKey);
    if (!seen.has(itemId)) {
      seen.add(itemId);
      orderedItemIds.push(itemId);
    }
  }

  return orderedItemIds.flatMap((itemId): SidebarProjectTreeRow[] => {
    const parsed = parseProjectTreeItemId(itemId);
    if (!parsed) {
      return [];
    }
    if (parsed.kind === "folder") {
      const folder = input.projectFoldersById[parsed.folderId];
      if (!folder) {
        return [];
      }
      return [
        {
          kind: "folder",
          itemId,
          folder,
          projects: sortFolderProjects({
            folder,
            projects: folderProjectsById.get(parsed.folderId) ?? [],
            projectSortOrder: input.projectSortOrder,
            sourceIndexByProjectKey,
          }),
        },
      ];
    }
    if (projectFolderIdByKey.has(parsed.projectKey)) {
      return [];
    }
    const project = projectsByKey.get(parsed.projectKey);
    return project ? [{ kind: "project", itemId, project }] : [];
  });
}

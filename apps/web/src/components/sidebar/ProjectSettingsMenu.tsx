import {
  CopyIcon,
  Edit3Icon,
  FolderPlusIcon,
  FolderOpenIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import { AtlassianJiraIcon } from "../Icons";
import { scopedProjectKey, scopeProjectRef } from "@ryco/client-runtime";
import { MenuGroup, MenuItem, MenuSeparator } from "../ui/menu";
import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { formatProjectMemberActionLabel } from "./sidebarProjectGroupingLabels";
import {
  resolveProjectRemoteLink,
  resolveRepositoryProviderIcon,
} from "./sidebarProjectRemoteLink";

export function ProjectSettingsMenu(props: {
  jiraProjectOpenUrlByProjectKey: ReadonlyMap<string, string>;
  project: SidebarProjectSnapshot;
  onCopyPath: (member: SidebarProjectGroupMember) => void;
  onGrouping: (member: SidebarProjectGroupMember) => void;
  onNewFolderWithProject: (project: SidebarProjectSnapshot) => void;
  onOpenJiraProject: (member: SidebarProjectGroupMember) => void;
  onOpenOverview: () => void;
  onOpenRemote: (member: SidebarProjectGroupMember) => void;
  onRemove: (member: SidebarProjectGroupMember) => void;
  onRename: (member: SidebarProjectGroupMember) => void;
  onSettings: (member: SidebarProjectGroupMember) => void;
}) {
  const renderActions = (member: SidebarProjectGroupMember) => {
    const remoteLink = resolveProjectRemoteLink(
      member.repositoryIdentity,
      member.preferredRemoteName,
    );
    const jiraProjectUrl =
      props.jiraProjectOpenUrlByProjectKey.get(
        scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
      ) ?? null;
    const RemoteIcon = resolveRepositoryProviderIcon(remoteLink?.provider);
    return (
      <>
        <MenuItem onClick={() => props.onSettings(member)} className="min-h-7 py-1 sm:text-xs">
          <SettingsIcon className="size-3.5" />
          Project settings
        </MenuItem>
        {remoteLink ? (
          <MenuItem onClick={() => props.onOpenRemote(member)} className="min-h-7 py-1 sm:text-xs">
            <RemoteIcon className="size-3.5" />
            Open remote
          </MenuItem>
        ) : null}
        {jiraProjectUrl ? (
          <MenuItem
            onClick={() => props.onOpenJiraProject(member)}
            className="min-h-7 py-1 sm:text-xs"
          >
            <AtlassianJiraIcon className="size-3.5" />
            Open Jira project
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem onClick={() => props.onRename(member)} className="min-h-7 py-1 sm:text-xs">
          <Edit3Icon className="size-3.5" />
          Rename project
        </MenuItem>
        <MenuItem onClick={() => props.onGrouping(member)} className="min-h-7 py-1 sm:text-xs">
          <SettingsIcon className="size-3.5" />
          Project grouping...
        </MenuItem>
        <MenuItem onClick={() => props.onCopyPath(member)} className="min-h-7 py-1 sm:text-xs">
          <CopyIcon className="size-3.5" />
          Copy Project Path
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          onClick={() => props.onRemove(member)}
          variant="destructive"
          className="min-h-7 py-1 sm:text-xs"
        >
          <Trash2Icon className="size-3.5" />
          Remove project
        </MenuItem>
      </>
    );
  };

  if (props.project.memberProjects.length === 1) {
    return (
      <MenuGroup>
        <MenuItem onClick={props.onOpenOverview} className="min-h-7 py-1 sm:text-xs">
          <FolderOpenIcon className="size-3.5" />
          Project overview
        </MenuItem>
        <MenuItem
          onClick={() => props.onNewFolderWithProject(props.project)}
          className="min-h-7 py-1 sm:text-xs"
        >
          <FolderPlusIcon className="size-3.5" />
          New folder with project
        </MenuItem>
        <MenuSeparator />
        {renderActions(props.project.memberProjects[0]!)}
      </MenuGroup>
    );
  }

  return (
    <>
      <MenuGroup>
        <MenuItem onClick={props.onOpenOverview} className="min-h-7 py-1 sm:text-xs">
          <FolderOpenIcon className="size-3.5" />
          Project overview
        </MenuItem>
        <MenuItem
          onClick={() => props.onNewFolderWithProject(props.project)}
          className="min-h-7 py-1 sm:text-xs"
        >
          <FolderPlusIcon className="size-3.5" />
          New folder with grouped project
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      {props.project.memberProjects.map((member, index) => (
        <MenuGroup key={member.physicalProjectKey}>
          <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
            {formatProjectMemberActionLabel(member, props.project.groupedProjectCount)}
          </div>
          {renderActions(member)}
          {index < props.project.memberProjects.length - 1 ? <MenuSeparator /> : null}
        </MenuGroup>
      ))}
    </>
  );
}

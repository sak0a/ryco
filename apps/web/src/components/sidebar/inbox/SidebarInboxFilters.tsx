import { FolderIcon, GitBranchIcon, MonitorIcon, SearchIcon } from "lucide-react";

import { SidebarInput } from "../../ui/sidebar";
import { InboxFilterCombobox, type InboxFilterOption } from "./InboxFilterCombobox";

export function SidebarInboxFilters(props: {
  readonly text: string;
  readonly environment: string;
  readonly project: string;
  readonly worktree: string;
  readonly environmentOptions: readonly InboxFilterOption[];
  readonly projectOptions: readonly InboxFilterOption[];
  readonly worktreeOptions: readonly InboxFilterOption[];
  readonly onTextChange: (value: string) => void;
  readonly onEnvironmentChange: (value: string) => void;
  readonly onProjectChange: (value: string) => void;
  readonly onWorktreeChange: (value: string) => void;
}) {
  return (
    <div className="shrink-0 bg-sidebar px-3 pb-2 pt-1">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3 -translate-y-1/2 text-muted-foreground"
        />
        <SidebarInput
          aria-label="Search Inbox"
          className="h-7 pl-7 text-xs"
          onChange={(event) => props.onTextChange(event.target.value)}
          placeholder="Search threads"
          type="search"
          value={props.text}
        />
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        <InboxFilterCombobox
          allArtwork={<MonitorIcon />}
          allLabel="Environment"
          category="environment"
          onChange={props.onEnvironmentChange}
          options={props.environmentOptions}
          value={props.environment}
        />
        <InboxFilterCombobox
          allArtwork={<FolderIcon />}
          allLabel="Project"
          category="project"
          onChange={props.onProjectChange}
          options={props.projectOptions}
          value={props.project}
        />
        <InboxFilterCombobox
          allArtwork={<GitBranchIcon />}
          allLabel="Worktree"
          category="worktree"
          onChange={props.onWorktreeChange}
          options={props.worktreeOptions}
          value={props.worktree}
        />
      </div>
    </div>
  );
}

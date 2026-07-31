import { SearchIcon } from "lucide-react";

import { SidebarInput } from "../../ui/sidebar";

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

const FILTER_SELECT_CLASS_NAME =
  "h-6 min-w-0 cursor-pointer rounded-md border border-sidebar-border bg-sidebar px-1.5 text-[10px] text-muted-foreground outline-hidden ring-ring focus-visible:ring-2";

function InboxFilterSelect(props: {
  readonly label: string;
  readonly allLabel: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={props.label}
      className={FILTER_SELECT_CLASS_NAME}
      onChange={(event) => props.onChange(event.target.value)}
      value={props.value}
    >
      <option value="all">{props.allLabel}</option>
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function SidebarInboxFilters(props: {
  readonly text: string;
  readonly environment: string;
  readonly project: string;
  readonly worktree: string;
  readonly environmentOptions: readonly SelectOption[];
  readonly projectOptions: readonly SelectOption[];
  readonly worktreeOptions: readonly SelectOption[];
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
      <div className="mt-1.5 grid grid-cols-3 gap-1">
        <InboxFilterSelect
          allLabel="All environments"
          label="Filter by environment"
          onChange={props.onEnvironmentChange}
          options={props.environmentOptions}
          value={props.environment}
        />
        <InboxFilterSelect
          allLabel="All projects"
          label="Filter by project"
          onChange={props.onProjectChange}
          options={props.projectOptions}
          value={props.project}
        />
        <InboxFilterSelect
          allLabel="All worktrees"
          label="Filter by worktree"
          onChange={props.onWorktreeChange}
          options={props.worktreeOptions}
          value={props.worktree}
        />
      </div>
    </div>
  );
}

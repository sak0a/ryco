import type {
  ChangeRequest,
  EnvironmentId,
  ProjectId,
  SourceControlIssueSummary,
  WorkItemStateFilter,
  WorkItemSummary,
} from "@ryco/contracts";
import { ChevronDownIcon, CircleDotIcon, GitBranchIcon, GitPullRequestIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { useGitBranches } from "../../rpc/useGit";
import { cn } from "~/lib/utils";
import { IssuesTab } from "../projectExplorer/IssuesTab";
import { PullRequestsTab } from "../projectExplorer/PullRequestsTab";
import { WorkItemsTab } from "../projectExplorer/WorkItemsTab";
import type {
  ChangeRequestStateFilter,
  IssueStateFilter,
} from "../projectExplorer/StateFilterButtons";
import { AtlassianJiraIcon } from "../Icons";
import { ContextPickerTabs } from "./ContextPickerTabs";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

export type NewThreadSourceTab = "branches" | "prs" | "issues" | "jira";

/** What the user picked as the origin for the worktree about to be created. */
export type NewThreadSource =
  | { readonly kind: "branch"; readonly branchName: string }
  | { readonly kind: "pr"; readonly changeRequest: ChangeRequest }
  | { readonly kind: "issue"; readonly issue: SourceControlIssueSummary }
  | { readonly kind: "workItem"; readonly workItem: WorkItemSummary };

export interface NewThreadSourcePickerProps {
  readonly label: string;
  /**
   * Which kind of thing `label` names. A branch is the unremarkable default and
   * stays plain; a PR, issue, or work item is a deliberate, less common choice,
   * so each gets its provider glyph in its own colour — the sentence should say
   * *what* you picked at a glance, not just its title.
   */
  readonly sourceKind: "branch" | "pr" | "issue" | "workItem" | null;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly cwd: string | null;
  readonly onSelect: (source: NewThreadSource) => void;
}

const BRANCH_LIMIT = 60;

/**
 * The `from …` token of the work-location sentence, when the target is a new
 * worktree.
 *
 * One popover with four segments rather than four controls or a jump into the
 * worktree dialog: the question ("where does this branch off from?") is one
 * question, and branch / PR / issue / work item are four answers to it.
 *
 * Only offered in new-worktree mode. Working directly in a checkout is a real
 * `git switch`, and a PR head or an issue is not something you can switch to.
 */
export function NewThreadSourcePicker({
  label,
  sourceKind,
  environmentId,
  projectId,
  cwd,
  onSelect,
}: NewThreadSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NewThreadSourceTab>("branches");
  const [branchQuery, setBranchQuery] = useState("");
  const [prQuery, setPrQuery] = useState("");
  const [issueQuery, setIssueQuery] = useState("");
  const [workItemQuery, setWorkItemQuery] = useState("");
  const [prStateFilter, setPrStateFilter] = useState<ChangeRequestStateFilter>("open");
  const [issueStateFilter, setIssueStateFilter] = useState<IssueStateFilter>("open");
  const [workItemStateFilter, setWorkItemStateFilter] = useState<WorkItemStateFilter>("open");
  const branchInputRef = useRef<HTMLInputElement>(null);
  const prInputRef = useRef<HTMLInputElement>(null);
  const issueInputRef = useRef<HTMLInputElement>(null);
  const workItemInputRef = useRef<HTMLInputElement>(null);

  const choose = useCallback(
    (source: NewThreadSource) => {
      setOpen(false);
      onSelect(source);
    },
    [onSelect],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Change what this worktree branches from (currently ${label})`}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 font-medium text-foreground/85 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        render={<button type="button" />}
      >
        <SourceKindGlyph kind={sourceKind} />
        <span className="min-w-0 max-w-[18rem] truncate">{label}</span>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        side="bottom"
        className="w-[30rem] overflow-hidden p-0"
        viewportClassName="p-0 [--viewport-inline-padding:0px]"
      >
        <ContextPickerTabs
          tabs={[
            { id: "branches", label: "Branch" },
            { id: "prs", label: "Pull requests" },
            { id: "issues", label: "Issues" },
            { id: "jira", label: "Jira" },
          ]}
          activeId={tab}
          density="compact"
          onSelect={(id) => setTab(id as NewThreadSourceTab)}
        />
        <div className="h-72 min-h-0">
          {tab === "branches" ? (
            <BranchSourceList
              environmentId={environmentId}
              cwd={cwd}
              query={branchQuery}
              searchInputRef={branchInputRef}
              onQueryChange={setBranchQuery}
              onSelect={(branchName) => choose({ kind: "branch", branchName })}
            />
          ) : tab === "prs" ? (
            <PullRequestsTab
              environmentId={environmentId}
              cwd={cwd}
              searchInputRef={prInputRef}
              query={prQuery}
              onQueryChange={setPrQuery}
              density="compact"
              stateFilter={prStateFilter}
              onStateFilterChange={setPrStateFilter}
              onSelect={(changeRequest) => choose({ kind: "pr", changeRequest })}
            />
          ) : tab === "issues" ? (
            <IssuesTab
              environmentId={environmentId}
              cwd={cwd}
              searchInputRef={issueInputRef}
              query={issueQuery}
              onQueryChange={setIssueQuery}
              density="compact"
              stateFilter={issueStateFilter}
              onStateFilterChange={setIssueStateFilter}
              onSelect={(issue) => choose({ kind: "issue", issue })}
            />
          ) : (
            <WorkItemsTab
              environmentId={environmentId}
              cwd={cwd}
              projectId={projectId}
              searchInputRef={workItemInputRef}
              query={workItemQuery}
              onQueryChange={setWorkItemQuery}
              stateFilter={workItemStateFilter}
              onStateFilterChange={setWorkItemStateFilter}
              onSelect={(workItem) => choose({ kind: "workItem", workItem })}
            />
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function SourceKindGlyph({ kind }: { readonly kind: NewThreadSourcePickerProps["sourceKind"] }) {
  const className = "size-3.5 shrink-0";
  switch (kind) {
    case "pr":
      return (
        <GitPullRequestIcon
          aria-label="Pull request"
          className={cn(className, "text-emerald-500 dark:text-emerald-400")}
        />
      );
    case "issue":
      return (
        <CircleDotIcon
          aria-label="Issue"
          className={cn(className, "text-sky-500 dark:text-sky-400")}
        />
      );
    case "workItem":
      return (
        <AtlassianJiraIcon
          aria-label="Jira work item"
          className={cn(className, "text-violet-500 dark:text-violet-400")}
        />
      );
    case "branch":
      return <GitBranchIcon aria-hidden className={cn(className, "text-muted-foreground")} />;
    default:
      return null;
  }
}

function BranchSourceList({
  environmentId,
  cwd,
  query,
  searchInputRef,
  onQueryChange,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly query: string;
  readonly searchInputRef: React.RefObject<HTMLInputElement | null>;
  readonly onQueryChange: (value: string) => void;
  readonly onSelect: (branchName: string) => void;
}) {
  const trimmedQuery = query.trim();
  const { refs, isPending } = useGitBranches({ environmentId, cwd, query: trimmedQuery });
  const visible = refs.slice(0, BRANCH_LIMIT);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border/40 border-b px-2 py-1.5">
        <div className="relative">
          <GitBranchIcon className="-translate-y-1/2 absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search branches..."
            className="h-8 pl-7 text-sm"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending && visible.length === 0 ? (
          <p className="px-2.5 py-4 text-sm text-muted-foreground">Loading branches...</p>
        ) : visible.length === 0 ? (
          <p className="px-2.5 py-4 text-sm text-muted-foreground">
            No branches match this search.
          </p>
        ) : (
          visible.map((ref) => (
            <button
              key={ref.name}
              type="button"
              onClick={() => onSelect(ref.name)}
              className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/60"
            >
              <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{ref.name}</span>
              {ref.isRemote ? (
                <span className={cn("shrink-0 text-[10px] text-muted-foreground/55")}>
                  {ref.remoteName ?? "remote"}
                </span>
              ) : ref.current ? (
                <span className={cn("shrink-0 text-[10px] text-muted-foreground/55")}>current</span>
              ) : ref.isDefault ? (
                <span className="shrink-0 text-[10px] text-muted-foreground/55">default</span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

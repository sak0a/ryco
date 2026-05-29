import type {
  ChangeRequest,
  EnvironmentId,
  GitCreateWorktreeForProjectOutput,
  ProjectId,
  SourceControlIssueSummary,
  VcsRef,
} from "@ryco/contracts";
import { GitBranchIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readEnvironmentApi } from "../../environmentApi";
import { ContextPickerTabs } from "../chat/ContextPickerTabs";
import { IssuesTab } from "../projectExplorer/IssuesTab";
import { PullRequestsTab } from "../projectExplorer/PullRequestsTab";
import type {
  ChangeRequestStateFilter,
  IssueStateFilter,
} from "../projectExplorer/StateFilterButtons";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

export type NewWorktreeDialogTab = "branches" | "prs" | "issues" | "newBranch";

interface NewWorktreeDialogProps {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  initialTab?: NewWorktreeDialogTab | undefined;
  open: boolean;
  projectId?: ProjectId | null | undefined;
  onCreated?: (result: GitCreateWorktreeForProjectOutput) => void;
  onOpenChange: (open: boolean) => void;
}

type Selection =
  | { kind: "issue"; item: SourceControlIssueSummary }
  | { kind: "pr"; item: ChangeRequest }
  | null;

export function NewWorktreeDialog(props: NewWorktreeDialogProps) {
  const [activeTab, setActiveTab] = useState<NewWorktreeDialogTab>(props.initialTab ?? "branches");
  const [branchQuery, setBranchQuery] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [issueQuery, setIssueQuery] = useState("");
  const [prQuery, setPrQuery] = useState("");
  const [issueStateFilter, setIssueStateFilter] = useState<IssueStateFilter>("open");
  const [prStateFilter, setPrStateFilter] = useState<ChangeRequestStateFilter>("open");
  const [selection, setSelection] = useState<Selection>(null);
  const [branchRefs, setBranchRefs] = useState<VcsRef[]>([]);
  const [selectedBranchName, setSelectedBranchName] = useState<string | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [existingWorktreeId, setExistingWorktreeId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);
  const issueInputRef = useRef<HTMLInputElement>(null);
  const prInputRef = useRef<HTMLInputElement>(null);
  const newBranchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.open) {
      setActiveTab(props.initialTab ?? "branches");
      setSelection(null);
      setCreateError(null);
      setExistingWorktreeId(null);
    }
  }, [props.initialTab, props.open]);

  const refreshBranches = useCallback(async () => {
    if (!props.open || activeTab !== "branches") {
      return;
    }
    const api = props.environmentId ? readEnvironmentApi(props.environmentId) : null;
    if (!api || !props.cwd) {
      setBranchRefs([]);
      setSelectedBranchName(null);
      setBranchesError("Project is unavailable.");
      return;
    }

    setBranchesLoading(true);
    setBranchesError(null);
    try {
      const query = branchQuery.trim();
      const result = await api.vcs.listRefs({
        cwd: props.cwd,
        limit: 100,
        ...(query ? { query } : {}),
      });
      setBranchRefs([...result.refs]);
      const defaultBranch = result.refs.find((branch) => branch.isDefault)?.name;
      if (defaultBranch && baseBranch === "main") {
        setBaseBranch(defaultBranch);
      }
      setSelectedBranchName((current) =>
        current && result.refs.some((branch) => branch.name === current)
          ? current
          : (result.refs[0]?.name ?? null),
      );
    } catch (error) {
      setBranchRefs([]);
      setSelectedBranchName(null);
      setBranchesError(error instanceof Error ? error.message : "Failed to load branches.");
    } finally {
      setBranchesLoading(false);
    }
  }, [activeTab, baseBranch, branchQuery, props.cwd, props.environmentId, props.open]);

  useEffect(() => {
    void refreshBranches();
  }, [refreshBranches]);

  useEffect(() => {
    if (!props.open || !props.projectId || !props.environmentId) {
      setExistingWorktreeId(null);
      return;
    }
    if (selection?.kind !== "pr" && selection?.kind !== "issue") {
      setExistingWorktreeId(null);
      return;
    }
    const api = readEnvironmentApi(props.environmentId);
    const findWorktree = api?.git.findWorktreeForOrigin;
    if (!findWorktree) {
      setExistingWorktreeId(null);
      return;
    }
    let cancelled = false;
    void findWorktree({
      projectId: props.projectId,
      kind: selection.kind,
      number: selection.item.number,
    })
      .then((worktreeId) => {
        if (!cancelled) {
          setExistingWorktreeId(worktreeId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExistingWorktreeId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.environmentId, props.open, props.projectId, selection]);

  useEffect(() => {
    if (!props.open) {
      setSelection(null);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (activeTab === "branches") branchInputRef.current?.focus();
      if (activeTab === "issues") issueInputRef.current?.focus();
      if (activeTab === "prs") prInputRef.current?.focus();
      if (activeTab === "newBranch") newBranchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, props.open]);

  const tabs = useMemo(
    () => [
      { id: "branches", label: "Branches" },
      { id: "prs", label: "Pull requests" },
      { id: "issues", label: "Issues" },
      { id: "newBranch", label: "New branch" },
    ],
    [],
  );

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) {
      return;
    }
    const tabByKey: Record<string, NewWorktreeDialogTab> = {
      "1": "branches",
      "2": "prs",
      "3": "issues",
      "4": "newBranch",
    };
    const nextTab = tabByKey[event.key];
    if (!nextTab) {
      return;
    }
    event.preventDefault();
    setActiveTab(nextTab);
    setSelection(null);
  }, []);

  const canCreate = useMemo(() => {
    if (!props.projectId || !props.environmentId || creating) {
      return false;
    }
    if (activeTab === "branches") {
      return selectedBranchName !== null && selectedBranchName.length > 0;
    }
    if (activeTab === "prs") {
      return selection?.kind === "pr";
    }
    if (activeTab === "issues") {
      return selection?.kind === "issue";
    }
    return true;
  }, [activeTab, creating, props.environmentId, props.projectId, selectedBranchName, selection]);

  const handleCreate = useCallback(async () => {
    if (!props.projectId || !props.environmentId) {
      setCreateError("Project is unavailable.");
      return;
    }
    const api = readEnvironmentApi(props.environmentId);
    const createWorktree = api?.git.createWorktreeForProject;
    if (!createWorktree) {
      setCreateError("Worktree creation is unavailable in this environment.");
      return;
    }

    const branchName = selectedBranchName ?? "";
    const trimmedNewBranchName = newBranchName.trim();
    const trimmedBaseBranch = baseBranch.trim();
    const intent =
      activeTab === "branches"
        ? branchName
          ? ({ kind: "branch", branchName } as const)
          : null
        : activeTab === "prs" && selection?.kind === "pr"
          ? ({ kind: "pr", number: selection.item.number } as const)
          : activeTab === "issues" && selection?.kind === "issue"
            ? ({
                kind: "issue",
                number: selection.item.number,
                title: selection.item.title,
              } as const)
            : activeTab === "newBranch" && trimmedNewBranchName.length > 0
              ? ({
                  kind: "newBranch",
                  ...(trimmedNewBranchName.length > 0 ? { branchName: trimmedNewBranchName } : {}),
                  ...(trimmedBaseBranch.length > 0 ? { baseBranch: trimmedBaseBranch } : {}),
                } as const)
              : null;
    if (!intent) {
      setCreateError("Select a worktree target first.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const result = await createWorktree({
        projectId: props.projectId,
        intent,
      });
      props.onCreated?.(result);
      props.onOpenChange(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create worktree.");
    } finally {
      setCreating(false);
    }
  }, [activeTab, baseBranch, newBranchName, props, selectedBranchName, selection]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup
        className="flex h-[80vh] max-h-[800px] w-full max-w-3xl flex-col p-0 sm:max-w-3xl"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="border-border/60 border-b px-5 py-3">
          <DialogTitle className="text-base">New worktree</DialogTitle>
          <DialogDescription className="text-xs">
            {props.cwd ?? "Select a project worktree target."}
          </DialogDescription>
        </DialogHeader>

        <ContextPickerTabs
          tabs={tabs}
          activeId={activeTab}
          onSelect={(id) => {
            setActiveTab(id as NewWorktreeDialogTab);
            setSelection(null);
          }}
        />

        <DialogPanel className="min-h-0 flex-1 p-0">
          {activeTab === "branches" ? (
            <BranchesTab
              branches={branchRefs}
              error={branchesError}
              isLoading={branchesLoading}
              query={branchQuery}
              selectedBranchName={selectedBranchName}
              searchInputRef={branchInputRef}
              onQueryChange={setBranchQuery}
              onRefresh={refreshBranches}
              onSelectBranch={setSelectedBranchName}
            />
          ) : activeTab === "prs" ? (
            <PullRequestsTab
              environmentId={props.environmentId}
              cwd={props.cwd}
              searchInputRef={prInputRef}
              query={prQuery}
              onQueryChange={setPrQuery}
              stateFilter={prStateFilter}
              onStateFilterChange={setPrStateFilter}
              onSelect={(item) => setSelection({ kind: "pr", item })}
            />
          ) : activeTab === "issues" ? (
            <IssuesTab
              environmentId={props.environmentId}
              cwd={props.cwd}
              searchInputRef={issueInputRef}
              query={issueQuery}
              onQueryChange={setIssueQuery}
              stateFilter={issueStateFilter}
              onStateFilterChange={setIssueStateFilter}
              onSelect={(item) => setSelection({ kind: "issue", item })}
            />
          ) : (
            <NewBranchTab
              baseBranch={baseBranch}
              branchName={newBranchName}
              branchNameInputRef={newBranchInputRef}
              onBaseBranchChange={setBaseBranch}
              onBranchNameChange={setNewBranchName}
            />
          )}
        </DialogPanel>

        <DialogFooter className="border-border/60 border-t px-5 py-3">
          {createError ? (
            <span className="mr-auto min-w-0 truncate text-xs text-destructive">{createError}</span>
          ) : selection ? (
            <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground">
              {selection.kind === "pr"
                ? `PR #${selection.item.number}: ${selection.item.title}`
                : `Issue #${selection.item.number}: ${selection.item.title}`}
            </span>
          ) : null}
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canCreate} onClick={() => void handleCreate()}>
            {creating
              ? "Creating..."
              : existingWorktreeId
                ? "Open existing worktree"
                : "Create worktree"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function BranchesTab(props: {
  branches: ReadonlyArray<VcsRef>;
  error: string | null;
  isLoading: boolean;
  query: string;
  selectedBranchName: string | null;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onSelectBranch: (branchName: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border/60 border-b px-4 py-2.5">
        <div className="relative flex-1">
          <GitBranchIcon className="-translate-y-1/2 absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
          <Input
            ref={props.searchInputRef}
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder="Search branches…"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={props.isLoading}
          onClick={props.onRefresh}
          aria-label="Refresh branches"
        >
          <RotateCwIcon className={props.isLoading ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.error ? (
          <p className="px-4 py-6 text-destructive text-sm">{props.error}</p>
        ) : props.isLoading && props.branches.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading branches...</p>
        ) : props.branches.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {props.query.trim().length > 0
              ? "No branches match this search."
              : "No branches to show."}
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {props.branches.map((branch) => (
              <button
                key={branch.name}
                type="button"
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 ${
                  props.selectedBranchName === branch.name ? "bg-muted/80" : ""
                }`}
                onClick={() => props.onSelectBranch(branch.name)}
              >
                <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{branch.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {branch.current
                      ? "Current branch"
                      : branch.worktreePath
                        ? branch.worktreePath
                        : branch.isRemote
                          ? (branch.remoteName ?? "Remote branch")
                          : "Local branch"}
                  </span>
                </span>
                {branch.isDefault ? (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
                    default
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewBranchTab(props: {
  baseBranch: string;
  branchName: string;
  branchNameInputRef: React.RefObject<HTMLInputElement | null>;
  onBaseBranchChange: (value: string) => void;
  onBranchNameChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-4 p-5">
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Branch name</span>
        <Input
          ref={props.branchNameInputRef}
          value={props.branchName}
          onChange={(event) => props.onBranchNameChange(event.target.value)}
          placeholder="task/short-name"
        />
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Base branch</span>
        <Input
          value={props.baseBranch}
          onChange={(event) => props.onBaseBranchChange(event.target.value)}
          placeholder="main"
        />
      </div>
    </div>
  );
}

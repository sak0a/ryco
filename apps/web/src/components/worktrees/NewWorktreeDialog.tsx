import type {
  ChangeRequest,
  EnvironmentId,
  GitCreateWorktreeForProjectOutput,
  ProjectId,
  SourceControlIssueSummary,
  VcsRef,
} from "@ryco/contracts";
import { ChevronDownIcon, GitBranchIcon, RotateCwIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requireEnvironmentConnection } from "../../environments/runtime";
import { readEnvironmentApi } from "../../environmentApi";
import { cn } from "~/lib/utils";
import { ContextPickerTabs } from "../chat/ContextPickerTabs";
import { IssuesTab } from "../projectExplorer/IssuesTab";
import { PullRequestsTab } from "../projectExplorer/PullRequestsTab";
import { changeRequestStateKind, StateBadge } from "../projectExplorer/StateBadge";
import type {
  ChangeRequestStateFilter,
  IssueStateFilter,
} from "../projectExplorer/StateFilterButtons";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "../ui/combobox";
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
  | { kind: "issue"; item: SourceControlIssueSummary & { readonly body?: string | undefined } }
  | { kind: "pr"; item: ChangeRequest }
  | null;

type IssueBranchMode = "ai" | "custom";
type NewBranchNameMode = "manual" | "ai";
type BranchNameGenerationTarget = "issue" | "newBranch";

const WORKTREE_BRANCH_REF_LIMIT = 100;

function sourceControlItemKey(item: { readonly provider: string; readonly number: number }) {
  return `${item.provider}:${item.number}`;
}

function branchLabel(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "branch";
}

function buildIssueBranchNameMessage(input: {
  readonly number: number;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
}) {
  const lines = [`Create a branch name for issue #${input.number}.`];
  const title = input.title?.trim();
  const body = input.body?.trim();
  if (title) {
    lines.push("", `Title: ${title}`);
  }
  if (body) {
    lines.push("", `Body: ${body}`);
  }
  return lines.join("\n");
}

function buildNewBranchNameMessage(input: { readonly baseBranch: string }) {
  return [
    "Create a short git branch name for a new coding-agent worktree.",
    `Base branch: ${branchLabel(input.baseBranch)}`,
  ].join("\n");
}

function useWorktreeBranchRefs(input: {
  readonly cwd: string | null;
  readonly enabled?: boolean;
  readonly environmentId: EnvironmentId | null;
  readonly open: boolean;
  readonly query: string;
}) {
  const [refs, setRefs] = useState<ReadonlyArray<VcsRef>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!input.open || input.enabled === false) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const api = input.environmentId ? readEnvironmentApi(input.environmentId) : null;
    if (!api || !input.cwd) {
      setRefs([]);
      setError("Project is unavailable.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const query = input.query.trim();
      const result = await api.vcs.listRefs({
        cwd: input.cwd,
        limit: WORKTREE_BRANCH_REF_LIMIT,
        ...(query ? { query } : {}),
      });
      if (requestIdRef.current === requestId) {
        setRefs([...result.refs]);
      }
    } catch (cause) {
      if (requestIdRef.current === requestId) {
        setRefs([]);
        setError(cause instanceof Error ? cause.message : "Failed to load branches.");
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [input.cwd, input.enabled, input.environmentId, input.open, input.query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { refs, isLoading, error, refresh };
}

export function NewWorktreeDialog(props: NewWorktreeDialogProps) {
  const [activeTab, setActiveTab] = useState<NewWorktreeDialogTab>(props.initialTab ?? "branches");
  const [branchQuery, setBranchQuery] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchNameMode, setNewBranchNameMode] = useState<NewBranchNameMode>("manual");
  const [baseBranch, setBaseBranch] = useState("main");
  const [issueBranchMode, setIssueBranchMode] = useState<IssueBranchMode>("ai");
  const [issueBranchName, setIssueBranchName] = useState("");
  const [issueQuery, setIssueQuery] = useState("");
  const [prQuery, setPrQuery] = useState("");
  const [issueStateFilter, setIssueStateFilter] = useState<IssueStateFilter>("open");
  const [prStateFilter, setPrStateFilter] = useState<ChangeRequestStateFilter>("open");
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedBranchName, setSelectedBranchName] = useState<string | null>(null);
  const [existingWorktreeId, setExistingWorktreeId] = useState<string | null>(null);
  const [branchNameGenerationTarget, setBranchNameGenerationTarget] =
    useState<BranchNameGenerationTarget | null>(null);
  const [branchNameGenerationError, setBranchNameGenerationError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);
  const issueInputRef = useRef<HTMLInputElement>(null);
  const prInputRef = useRef<HTMLInputElement>(null);
  const newBranchInputRef = useRef<HTMLInputElement>(null);

  const branchSearch = useWorktreeBranchRefs({
    open: props.open,
    enabled: activeTab === "branches",
    environmentId: props.environmentId,
    cwd: props.cwd,
    query: branchQuery,
  });

  useEffect(() => {
    if (props.open) {
      setActiveTab(props.initialTab ?? "branches");
      setSelection(null);
      setCreateError(null);
      setExistingWorktreeId(null);
      setBranchNameGenerationError(null);
      setBranchNameGenerationTarget(null);
    }
  }, [props.initialTab, props.open]);

  useEffect(() => {
    if (!props.open || activeTab !== "branches") {
      return;
    }
    if (branchSearch.error) {
      setSelectedBranchName(null);
      return;
    }
    setSelectedBranchName((current) =>
      current && branchSearch.refs.some((branch) => branch.name === current)
        ? current
        : (branchSearch.refs[0]?.name ?? null),
    );
  }, [activeTab, branchSearch.error, branchSearch.refs, props.open]);

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
      { id: "branches", label: "From branch" },
      { id: "newBranch", label: "New branch" },
      { id: "prs", label: "Pull requests" },
      { id: "issues", label: "Issues" },
    ],
    [],
  );

  const handleDefaultBranchDiscovered = useCallback((defaultBranch: string) => {
    setBaseBranch((current) => (current.trim() === "main" ? defaultBranch : current));
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) {
      return;
    }
    const tabByKey: Record<string, NewWorktreeDialogTab> = {
      "1": "branches",
      "2": "newBranch",
      "3": "prs",
      "4": "issues",
    };
    const nextTab = tabByKey[event.key];
    if (!nextTab) {
      return;
    }
    event.preventDefault();
    setActiveTab(nextTab);
    setSelection(null);
  }, []);

  const handleGenerateBranchName = useCallback(
    async (target: BranchNameGenerationTarget) => {
      if (!props.environmentId || !props.cwd) {
        setBranchNameGenerationError("Branch name generation is unavailable.");
        return;
      }

      const message =
        target === "issue"
          ? selection?.kind === "issue"
            ? buildIssueBranchNameMessage({
                number: selection.item.number,
                title: selection.item.title,
                body: selection.item.body,
              })
            : null
          : buildNewBranchNameMessage({ baseBranch });

      if (!message) {
        setBranchNameGenerationError("Select an issue before generating a branch name.");
        return;
      }

      setBranchNameGenerationTarget(target);
      setBranchNameGenerationError(null);
      try {
        const result = await requireEnvironmentConnection(
          props.environmentId,
        ).client.textGeneration.generateBranchName({
          cwd: props.cwd,
          message,
        });
        const branch = result.branch.trim();
        if (!branch) {
          throw new Error("AI returned an empty branch name.");
        }
        if (target === "issue") {
          setIssueBranchMode("custom");
          setIssueBranchName(branch);
        } else {
          setNewBranchNameMode("ai");
          setNewBranchName(branch);
        }
      } catch (cause) {
        setBranchNameGenerationError(
          cause instanceof Error ? cause.message : "Failed to generate branch name.",
        );
      } finally {
        setBranchNameGenerationTarget(null);
      }
    },
    [baseBranch, props.cwd, props.environmentId, selection],
  );

  const selectedPrKey = selection?.kind === "pr" ? sourceControlItemKey(selection.item) : null;
  const selectedIssueKey =
    selection?.kind === "issue" ? sourceControlItemKey(selection.item) : null;

  const canCreate = useMemo(() => {
    if (!props.projectId || !props.environmentId || creating) {
      return false;
    }
    const trimmedBaseBranch = baseBranch.trim();
    if (activeTab === "branches") {
      return selectedBranchName !== null && selectedBranchName.length > 0;
    }
    if (activeTab === "prs") {
      return selection?.kind === "pr";
    }
    if (activeTab === "issues") {
      if (selection?.kind !== "issue") {
        return false;
      }
      if (existingWorktreeId) {
        return true;
      }
      return (
        trimmedBaseBranch.length > 0 &&
        (issueBranchMode === "ai" || issueBranchName.trim().length > 0)
      );
    }
    return trimmedBaseBranch.length > 0 && newBranchName.trim().length > 0;
  }, [
    activeTab,
    baseBranch,
    creating,
    existingWorktreeId,
    issueBranchMode,
    issueBranchName,
    newBranchName,
    props.environmentId,
    props.projectId,
    selectedBranchName,
    selection,
  ]);

  const createButtonLabel = useMemo(() => {
    if (creating) {
      return "Creating...";
    }
    if (existingWorktreeId) {
      return "Open existing worktree";
    }
    if (activeTab === "branches" && selectedBranchName) {
      return `Create worktree from ${selectedBranchName}`;
    }
    if (activeTab === "newBranch") {
      const branch = newBranchName.trim();
      return branch
        ? `Create worktree from ${branchLabel(baseBranch)} as ${branch}`
        : `Create worktree from ${branchLabel(baseBranch)}`;
    }
    if (activeTab === "issues") {
      if (issueBranchMode === "custom" && issueBranchName.trim()) {
        return `Create worktree from ${branchLabel(baseBranch)} as ${issueBranchName.trim()}`;
      }
      return `Create worktree from ${branchLabel(baseBranch)}`;
    }
    if (activeTab === "prs" && selection?.kind === "pr") {
      return `Create worktree for PR #${selection.item.number}`;
    }
    return "Create worktree";
  }, [
    activeTab,
    baseBranch,
    creating,
    existingWorktreeId,
    issueBranchMode,
    issueBranchName,
    newBranchName,
    selectedBranchName,
    selection,
  ]);

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
    const trimmedIssueBranchName = issueBranchName.trim();
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
                ...(trimmedBaseBranch.length > 0 ? { baseBranch: trimmedBaseBranch } : {}),
                ...(issueBranchMode === "custom" && trimmedIssueBranchName.length > 0
                  ? { branchName: trimmedIssueBranchName }
                  : {}),
                title: selection.item.title,
                ...(selection.item.body !== undefined ? { body: selection.item.body } : {}),
              } as const)
            : activeTab === "newBranch" && trimmedNewBranchName.length > 0
              ? ({
                  kind: "newBranch",
                  branchName: trimmedNewBranchName,
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
  }, [
    activeTab,
    baseBranch,
    issueBranchMode,
    issueBranchName,
    newBranchName,
    props,
    selectedBranchName,
    selection,
  ]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup
        className="flex h-[90vh] max-h-[980px] w-full max-w-7xl flex-col p-0 sm:max-w-7xl"
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
            setCreateError(null);
            setBranchNameGenerationError(null);
          }}
        />

        <DialogPanel className="min-h-0 flex-1 p-0" scrollFade={false}>
          <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-h-[24rem] min-w-0 md:min-h-0">
              {activeTab === "branches" ? (
                <BranchesTab
                  branches={branchSearch.refs}
                  error={branchSearch.error}
                  isLoading={branchSearch.isLoading}
                  query={branchQuery}
                  selectedBranchName={selectedBranchName}
                  searchInputRef={branchInputRef}
                  onQueryChange={setBranchQuery}
                  onRefresh={branchSearch.refresh}
                  onSelectBranch={setSelectedBranchName}
                />
              ) : activeTab === "prs" ? (
                <PullRequestsTab
                  environmentId={props.environmentId}
                  cwd={props.cwd}
                  searchInputRef={prInputRef}
                  query={prQuery}
                  onQueryChange={setPrQuery}
                  selectedKey={selectedPrKey}
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
                  selectedKey={selectedIssueKey}
                  stateFilter={issueStateFilter}
                  onStateFilterChange={setIssueStateFilter}
                  onSelect={(item) => setSelection({ kind: "issue", item })}
                />
              ) : (
                <NewBranchTab
                  baseBranch={baseBranch}
                  branchName={newBranchName}
                  branchNameInputRef={newBranchInputRef}
                  branchNameMode={newBranchNameMode}
                  cwd={props.cwd}
                  dialogOpen={props.open}
                  environmentId={props.environmentId}
                  generationError={branchNameGenerationError}
                  isGenerating={branchNameGenerationTarget === "newBranch"}
                  onBaseBranchChange={setBaseBranch}
                  onBranchNameChange={(value) => {
                    setNewBranchName(value);
                    setNewBranchNameMode("manual");
                  }}
                  onBranchNameModeChange={setNewBranchNameMode}
                  onDefaultBranchDiscovered={handleDefaultBranchDiscovered}
                  onGenerateBranchName={() => void handleGenerateBranchName("newBranch")}
                />
              )}
            </div>
            <WorktreeCreateSummary
              activeTab={activeTab}
              baseBranch={baseBranch}
              branchNameGenerationError={branchNameGenerationError}
              cwd={props.cwd}
              dialogOpen={props.open}
              environmentId={props.environmentId}
              existingWorktreeId={existingWorktreeId}
              generationTarget={branchNameGenerationTarget}
              issueBranchMode={issueBranchMode}
              issueBranchName={issueBranchName}
              newBranchName={newBranchName}
              selection={selection}
              selectedBranchName={selectedBranchName}
              onBaseBranchChange={setBaseBranch}
              onDefaultBranchDiscovered={handleDefaultBranchDiscovered}
              onGenerateIssueBranchName={() => void handleGenerateBranchName("issue")}
              onIssueBranchModeChange={setIssueBranchMode}
              onIssueBranchNameChange={setIssueBranchName}
            />
          </div>
        </DialogPanel>

        <DialogFooter className="border-border/60 border-t px-5 py-3">
          {createError ? (
            <span className="mr-auto min-w-0 truncate text-xs text-destructive">{createError}</span>
          ) : branchNameGenerationError ? (
            <span className="mr-auto min-w-0 truncate text-xs text-destructive">
              {branchNameGenerationError}
            </span>
          ) : null}
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="max-w-[min(34rem,64vw)]"
            disabled={!canCreate}
            onClick={() => void handleCreate()}
          >
            <span className="truncate">{createButtonLabel}</span>
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
            placeholder="Search branches..."
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
          <div role="listbox" className="divide-y divide-border/60">
            {props.branches.map((branch) => {
              const isSelected = props.selectedBranchName === branch.name;
              return (
                <button
                  key={branch.name}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-accent/60 focus-visible:outline-none",
                    isSelected && "bg-muted/80",
                  )}
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
                  {isSelected ? (
                    <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary uppercase">
                      selected
                    </span>
                  ) : branch.isDefault ? (
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
                      default
                    </span>
                  ) : null}
                </button>
              );
            })}
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
  branchNameMode: NewBranchNameMode;
  cwd: string | null;
  dialogOpen: boolean;
  environmentId: EnvironmentId | null;
  generationError: string | null;
  isGenerating: boolean;
  onBaseBranchChange: (value: string) => void;
  onBranchNameChange: (value: string) => void;
  onBranchNameModeChange: (value: NewBranchNameMode) => void;
  onDefaultBranchDiscovered: (branchName: string) => void;
  onGenerateBranchName: () => void;
}) {
  return (
    <div className="grid gap-5 p-5">
      <div className="grid gap-2">
        <span className="text-xs font-medium text-foreground">From branch</span>
        <BranchRefPicker
          cwd={props.cwd}
          dialogOpen={props.dialogOpen}
          environmentId={props.environmentId}
          value={props.baseBranch}
          onChange={props.onBaseBranchChange}
          onDefaultBranchDiscovered={props.onDefaultBranchDiscovered}
        />
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-foreground">Create branch</span>
          <BranchNameModeControl
            value={props.branchNameMode}
            left={{ value: "manual", label: "Manual" }}
            right={{ value: "ai", label: "AI name" }}
            onChange={props.onBranchNameModeChange}
          />
        </div>
        <div className="flex items-center gap-2">
          <Input
            ref={props.branchNameInputRef}
            value={props.branchName}
            onChange={(event) => props.onBranchNameChange(event.target.value)}
            placeholder="task/short-name"
            className="font-mono text-xs"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={props.isGenerating}
            onClick={props.onGenerateBranchName}
            aria-label="Generate branch name"
          >
            {props.branchNameMode === "ai" ? (
              <SparklesIcon
                className={props.isGenerating ? "size-3.5 animate-pulse" : "size-3.5"}
              />
            ) : (
              <SparklesIcon className="size-3.5" />
            )}
          </Button>
        </div>
        {props.generationError ? (
          <span className="text-destructive text-xs">{props.generationError}</span>
        ) : (
          <span className="text-muted-foreground text-xs">
            AI names are editable before the worktree is created.
          </span>
        )}
      </div>
    </div>
  );
}

function WorktreeCreateSummary(props: {
  activeTab: NewWorktreeDialogTab;
  baseBranch: string;
  branchNameGenerationError: string | null;
  cwd: string | null;
  dialogOpen: boolean;
  environmentId: EnvironmentId | null;
  existingWorktreeId: string | null;
  generationTarget: BranchNameGenerationTarget | null;
  issueBranchMode: IssueBranchMode;
  issueBranchName: string;
  newBranchName: string;
  selection: Selection;
  selectedBranchName: string | null;
  onBaseBranchChange: (value: string) => void;
  onDefaultBranchDiscovered: (branchName: string) => void;
  onGenerateIssueBranchName: () => void;
  onIssueBranchModeChange: (value: IssueBranchMode) => void;
  onIssueBranchNameChange: (value: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col gap-4 border-border/60 border-t bg-muted/20 p-4 md:border-t-0 md:border-l">
      <div className="grid gap-1">
        <span className="font-medium text-muted-foreground text-xs uppercase">Worktree target</span>
        <span className="text-sm text-foreground">
          {props.activeTab === "branches"
            ? "Existing branch"
            : props.activeTab === "newBranch"
              ? "New branch"
              : props.activeTab === "prs"
                ? "Pull request"
                : "Issue"}
        </span>
      </div>

      {props.activeTab === "branches" ? (
        <BranchSummary branchName={props.selectedBranchName} />
      ) : props.activeTab === "newBranch" ? (
        <NewBranchSummary baseBranch={props.baseBranch} branchName={props.newBranchName} />
      ) : props.activeTab === "prs" ? (
        <PullRequestSummary
          existingWorktreeId={props.existingWorktreeId}
          selection={props.selection?.kind === "pr" ? props.selection.item : null}
        />
      ) : (
        <IssueSummary
          baseBranch={props.baseBranch}
          branchName={props.issueBranchName}
          branchMode={props.issueBranchMode}
          cwd={props.cwd}
          dialogOpen={props.dialogOpen}
          environmentId={props.environmentId}
          existingWorktreeId={props.existingWorktreeId}
          generationError={props.branchNameGenerationError}
          isGenerating={props.generationTarget === "issue"}
          selection={props.selection?.kind === "issue" ? props.selection.item : null}
          onBaseBranchChange={props.onBaseBranchChange}
          onBranchModeChange={props.onIssueBranchModeChange}
          onBranchNameChange={props.onIssueBranchNameChange}
          onDefaultBranchDiscovered={props.onDefaultBranchDiscovered}
          onGenerateBranchName={props.onGenerateIssueBranchName}
        />
      )}
    </aside>
  );
}

function BranchSummary(props: { branchName: string | null }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/70 p-3">
      <div className="flex items-center gap-2">
        <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-sm">
          {props.branchName ?? "Select a branch"}
        </span>
      </div>
      <p className="mt-2 text-muted-foreground text-xs">
        A new worktree branch will be created from this ref.
      </p>
    </div>
  );
}

function NewBranchSummary(props: { baseBranch: string; branchName: string }) {
  return (
    <div className="grid gap-3 rounded-md border border-border/60 bg-background/70 p-3">
      <SummaryRow label="From" value={branchLabel(props.baseBranch)} mono />
      <SummaryRow
        label="Create"
        value={props.branchName.trim() || "Enter or generate a branch name"}
        mono
      />
    </div>
  );
}

function PullRequestSummary(props: {
  existingWorktreeId: string | null;
  selection: ChangeRequest | null;
}) {
  if (!props.selection) {
    return (
      <p className="rounded-md border border-dashed border-border/70 p-3 text-muted-foreground text-sm">
        Select a pull request from the list.
      </p>
    );
  }

  return (
    <div className="grid gap-3 rounded-md border border-border/60 bg-background/70 p-3">
      <div className="flex items-start gap-2">
        <StateBadge
          kind={changeRequestStateKind(props.selection.state, props.selection.isDraft)}
          className="mt-0.5 shrink-0"
        />
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs">PR #{props.selection.number}</div>
          <div className="line-clamp-2 font-medium text-sm">{props.selection.title}</div>
        </div>
      </div>
      <SummaryRow
        label="Branch"
        value={`${props.selection.headRefName} -> ${props.selection.baseRefName}`}
        mono
      />
      {props.selection.author ? <SummaryRow label="Author" value={props.selection.author} /> : null}
      {props.existingWorktreeId ? (
        <span className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-primary text-xs">
          Existing worktree found
        </span>
      ) : null}
    </div>
  );
}

function IssueSummary(props: {
  baseBranch: string;
  branchMode: IssueBranchMode;
  branchName: string;
  cwd: string | null;
  dialogOpen: boolean;
  environmentId: EnvironmentId | null;
  existingWorktreeId: string | null;
  generationError: string | null;
  isGenerating: boolean;
  selection: (SourceControlIssueSummary & { readonly body?: string | undefined }) | null;
  onBaseBranchChange: (value: string) => void;
  onBranchModeChange: (value: IssueBranchMode) => void;
  onBranchNameChange: (value: string) => void;
  onDefaultBranchDiscovered: (branchName: string) => void;
  onGenerateBranchName: () => void;
}) {
  if (!props.selection) {
    return (
      <p className="rounded-md border border-dashed border-border/70 p-3 text-muted-foreground text-sm">
        Select an issue from the list.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-md border border-border/60 bg-background/70 p-3">
        <div className="flex items-start gap-2">
          <StateBadge
            kind={props.selection.state === "open" ? "issue-open" : "issue-closed"}
            className="mt-0.5 shrink-0"
          />
          <div className="min-w-0">
            <div className="text-muted-foreground text-xs">Issue #{props.selection.number}</div>
            <div className="line-clamp-2 font-medium text-sm">{props.selection.title}</div>
          </div>
        </div>
        {props.selection.author ? (
          <SummaryRow label="Author" value={props.selection.author} />
        ) : null}
        {props.existingWorktreeId ? (
          <span className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-primary text-xs">
            Existing worktree found
          </span>
        ) : null}
      </div>

      <div className="grid gap-3">
        <div className="grid gap-2">
          <span className="text-xs font-medium text-foreground">From branch</span>
          <BranchRefPicker
            cwd={props.cwd}
            dialogOpen={props.dialogOpen}
            environmentId={props.environmentId}
            value={props.baseBranch}
            onChange={props.onBaseBranchChange}
            onDefaultBranchDiscovered={props.onDefaultBranchDiscovered}
          />
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-foreground">Branch name</span>
            <BranchNameModeControl
              value={props.branchMode}
              left={{ value: "ai", label: "AI" }}
              right={{ value: "custom", label: "Custom" }}
              onChange={props.onBranchModeChange}
            />
          </div>
          {props.branchMode === "ai" ? (
            <p className="rounded-md border border-border/60 bg-background/60 px-3 py-2 text-muted-foreground text-xs">
              The branch name will be generated from the selected issue when the worktree is
              created.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={props.branchName}
                onChange={(event) => props.onBranchNameChange(event.target.value)}
                placeholder="issue/short-name"
                className="font-mono text-xs"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={props.isGenerating}
                onClick={props.onGenerateBranchName}
                aria-label="Generate issue branch name"
              >
                <SparklesIcon
                  className={props.isGenerating ? "size-3.5 animate-pulse" : "size-3.5"}
                />
              </Button>
            </div>
          )}
          {props.generationError ? (
            <span className="text-destructive text-xs">{props.generationError}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-muted-foreground text-[11px] uppercase">{props.label}</span>
      <span className={cn("min-w-0 truncate text-sm", props.mono && "font-mono text-xs")}>
        {props.value}
      </span>
    </div>
  );
}

function BranchNameModeControl<TValue extends string>(props: {
  value: TValue;
  left: { value: TValue; label: string };
  right: { value: TValue; label: string };
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border/60 bg-muted/40 p-0.5">
      {[props.left, props.right].map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={props.value === option.value}
          onClick={() => props.onChange(option.value)}
          className={cn(
            "rounded px-2 py-0.5 text-xs transition-colors",
            props.value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BranchRefPicker(props: {
  cwd: string | null;
  dialogOpen: boolean;
  environmentId: EnvironmentId | null;
  value: string;
  onChange: (value: string) => void;
  onDefaultBranchDiscovered: (branchName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const branchSearch = useWorktreeBranchRefs({
    cwd: props.cwd,
    enabled: true,
    environmentId: props.environmentId,
    open: props.dialogOpen,
    query: open ? query : "",
  });
  const { onDefaultBranchDiscovered } = props;

  useEffect(() => {
    const defaultBranch = branchSearch.refs.find((branch) => branch.isDefault)?.name;
    if (defaultBranch) {
      onDefaultBranchDiscovered(defaultBranch);
    }
  }, [branchSearch.refs, onDefaultBranchDiscovered]);

  const items = useMemo(() => branchSearch.refs.map((branch) => branch.name), [branchSearch.refs]);
  const branchByName = useMemo(
    () => new Map(branchSearch.refs.map((branch) => [branch.name, branch] as const)),
    [branchSearch.refs],
  );

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
    }
  }, []);

  return (
    <Combobox
      items={items}
      filteredItems={items}
      open={open}
      value={props.value}
      onOpenChange={handleOpenChange}
    >
      <ComboboxTrigger
        ref={triggerRef}
        render={<Button variant="outline" />}
        className="h-8 w-full justify-between px-2 font-mono text-xs"
      >
        <span className="min-w-0 truncate">{props.value || "Select branch"}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </ComboboxTrigger>
      <ComboboxPopup
        anchor={triggerRef}
        className="w-[min(42rem,var(--available-width))] overflow-hidden bg-popover shadow-xl/10 [&_[data-slot=combobox-list]]:bg-popover [&_[data-slot=combobox-popup]]:bg-popover"
      >
        <div className="border-b p-1">
          <ComboboxInput
            className="[&_input]:font-sans rounded-md"
            inputClassName="ring-0"
            placeholder="Search refs..."
            showTrigger={false}
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <ComboboxEmpty>No refs found.</ComboboxEmpty>
        <ComboboxList className="max-h-56">
          {items.map((item, index) => {
            const ref = branchByName.get(item);
            const badge = ref?.current
              ? "current"
              : ref?.worktreePath
                ? "worktree"
                : ref?.isRemote
                  ? "remote"
                  : ref?.isDefault
                    ? "default"
                    : null;
            return (
              <ComboboxItem
                key={item}
                index={index}
                value={item}
                onClick={() => {
                  props.onChange(item);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs">{item}</span>
                  {badge ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground/55">{badge}</span>
                  ) : null}
                </div>
              </ComboboxItem>
            );
          })}
        </ComboboxList>
        <ComboboxStatus>
          {branchSearch.error
            ? branchSearch.error
            : branchSearch.isLoading
              ? "Loading refs..."
              : items.length >= WORKTREE_BRANCH_REF_LIMIT
                ? `Showing first ${WORKTREE_BRANCH_REF_LIMIT} refs`
                : ""}
        </ComboboxStatus>
      </ComboboxPopup>
    </Combobox>
  );
}

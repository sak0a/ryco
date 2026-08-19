import { useAtomValue } from "@effect/atom-react";
import { appAtomRegistry } from "@ryco/client-runtime/rpc";
import type {
  ChangeRequest,
  EnvironmentId,
  SourceControlAddCommentReactionInput,
  SourceControlAddChangeRequestCommentInput,
  SourceControlAddIssueCommentInput,
  SourceControlAssigneeCandidate,
  SourceControlChangeRequestDetail,
  SourceControlChangeRequestMergeMethod,
  SourceControlCommentReaction,
  SourceControlCommentReactionContent,
  SourceControlCreateIssueInput,
  SourceControlIssueComment,
  SourceControlIssueDetail,
  SourceControlIssueSummary,
  SourceControlLabel,
  SourceControlRepositorySearchResult,
  SourceControlWorkflowJobLogResult,
  SourceControlWorkflowRunJobsResult,
  SourceControlWorkflowRunListResult,
} from "@ryco/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { requireEnvironmentConnection } from "~/environments/runtime";
import { useSettings } from "~/hooks/useSettings";
import {
  changeRequestDetailBinding,
  changeRequestDiffBinding,
  changeRequestListBinding,
  changeRequestSearchBinding,
  issueAssigneesBinding,
  issueDetailBinding,
  issueLabelsBinding,
  issueListBinding,
  issueSearchBinding,
  invalidateSourceControl,
  mergeSourceControlChangeRequest,
  repositorySearchBinding,
  workflowJobLogBinding,
  workflowRunJobsBinding,
  workflowRunsBinding,
  type QueryBinding,
  type SourceControlChangeRequestDetailInput,
  type SourceControlChangeRequestDiffInput,
  type SourceControlChangeRequestListInput,
  type SourceControlChangeRequestSearchInput,
  type SourceControlIssueDetailInput,
  type SourceControlIssueListInput,
  type SourceControlIssueMetaInput,
  type SourceControlIssueSearchInput,
  type SourceControlQueryState,
  type SourceControlRepositorySearchInput,
  type SourceControlWorkflowJobLogInput,
  type SourceControlWorkflowRunJobsInput,
  type SourceControlWorkflowRunsInput,
} from "./sourceControlAtoms";
import {
  resolveSourceControlRefreshDelay,
  shouldRefreshSourceControlOnLifecycle,
} from "./sourceControlRefreshPolicy";

export {
  fetchSourceControlChangeRequestDetail,
  fetchSourceControlIssueDetail,
  invalidateSourceControl,
  type SourceControlRepositorySearchInput,
  type SourceControlQueryState,
} from "./sourceControlAtoms";

type CommentReactionDetail = SourceControlIssueDetail | SourceControlChangeRequestDetail;

type SourceControlWorkflowRerunPayload =
  | { readonly target: "failed-jobs" }
  | { readonly target: "job"; readonly jobId: string };

function toggleReactionList(
  reactions: ReadonlyArray<SourceControlCommentReaction> | undefined,
  content: SourceControlCommentReactionContent,
): ReadonlyArray<SourceControlCommentReaction> | undefined {
  const existing = reactions?.find((reaction) => reaction.content === content);
  const others = reactions?.filter((reaction) => reaction.content !== content) ?? [];
  if (!existing) {
    return [...others, { content, count: 1, viewerHasReacted: true }];
  }
  const viewerHasReacted = existing.viewerHasReacted === true;
  const nextCount = viewerHasReacted ? Math.max(0, existing.count - 1) : existing.count + 1;
  if (nextCount <= 0) return others.length > 0 ? others : undefined;
  return [...others, { ...existing, count: nextCount, viewerHasReacted: !viewerHasReacted }];
}

function toggleCommentReactionInDetail<TDetail extends CommentReactionDetail>(
  detail: TDetail | null | undefined,
  input: Pick<SourceControlAddCommentReactionInput, "commentId" | "content">,
): TDetail | null | undefined {
  if (!detail) return detail;
  let changed = false;
  const comments = detail.comments.map((comment): SourceControlIssueComment => {
    if (comment.id !== input.commentId) return comment;
    changed = true;
    const reactions = toggleReactionList(comment.reactions, input.content);
    if (reactions) return { ...comment, reactions };
    const { reactions: _reactions, ...rest } = comment;
    return rest;
  });
  return changed ? ({ ...detail, comments } as TDetail) : detail;
}

// ---------------------------------------------------------------------------
// Reactive read hooks (atom-backed replacements for the former
// `useQuery(*QueryOptions(...))` source-control reads).
// ---------------------------------------------------------------------------

function useWatchedQuery<TInput, TData>(
  binding: QueryBinding<TInput, TData>,
  input: TInput,
  resolveIntervalMs?: (data: TData | null) => number | false,
): SourceControlQueryState<TData> {
  const targetKey = binding.targetKey(input);
  const refreshMode = useSettings((settings) => settings.sourceControlRefreshMode);
  const inputRef = useRef(input);
  inputRef.current = input;
  const resolveIntervalRef = useRef(resolveIntervalMs);
  resolveIntervalRef.current = resolveIntervalMs;
  const refreshModeRef = useRef(refreshMode);
  refreshModeRef.current = refreshMode;

  useEffect(() => {
    return binding.watch(inputRef.current, {
      resolveIntervalMs: (data) =>
        refreshModeRef.current === "manual"
          ? false
          : (resolveIntervalRef.current?.(data as TData | null) ?? false),
      shouldRefreshOnLifecycle: ({ hasData, lastFetchedAt, staleTime }) =>
        shouldRefreshSourceControlOnLifecycle({
          mode: refreshModeRef.current,
          hasData,
          invalidated: false,
          lastFetchedAtMs: lastFetchedAt,
          staleTimeMs: staleTime,
        }),
    });
  }, [binding, refreshMode, targetKey]);

  return useAtomValue(binding.atomFor(input));
}

export function useSourceControlIssueList(
  input: SourceControlIssueListInput,
): SourceControlQueryState<ReadonlyArray<SourceControlIssueSummary>> {
  return useWatchedQuery(issueListBinding, input);
}

export function useSourceControlChangeRequestList(
  input: SourceControlChangeRequestListInput,
  resolveIntervalMs?: (data: ReadonlyArray<ChangeRequest> | null) => number | false,
): SourceControlQueryState<ReadonlyArray<ChangeRequest>> {
  return useWatchedQuery(changeRequestListBinding, input, resolveIntervalMs);
}

export function useSourceControlIssueSearch(
  input: SourceControlIssueSearchInput,
): SourceControlQueryState<ReadonlyArray<SourceControlIssueSummary>> {
  return useWatchedQuery(issueSearchBinding, input);
}

export function useSourceControlChangeRequestSearch(
  input: SourceControlChangeRequestSearchInput,
): SourceControlQueryState<ReadonlyArray<ChangeRequest>> {
  return useWatchedQuery(changeRequestSearchBinding, input);
}

export function useSourceControlRepositorySearch(
  input: SourceControlRepositorySearchInput,
): SourceControlQueryState<SourceControlRepositorySearchResult> {
  return useWatchedQuery(repositorySearchBinding, input);
}

export function useSourceControlIssueLabels(
  input: SourceControlIssueMetaInput,
): SourceControlQueryState<ReadonlyArray<SourceControlLabel>> {
  return useWatchedQuery(issueLabelsBinding, input);
}

export function useSourceControlIssueAssignees(
  input: SourceControlIssueMetaInput,
): SourceControlQueryState<ReadonlyArray<SourceControlAssigneeCandidate>> {
  return useWatchedQuery(issueAssigneesBinding, input);
}

export function useSourceControlIssueDetail(
  input: SourceControlIssueDetailInput,
): SourceControlQueryState<SourceControlIssueDetail> {
  return useWatchedQuery(issueDetailBinding, input);
}

export function useSourceControlChangeRequestDetail(
  input: SourceControlChangeRequestDetailInput,
  resolveIntervalMs?: (data: SourceControlChangeRequestDetail | null) => number | false,
): SourceControlQueryState<SourceControlChangeRequestDetail> {
  return useWatchedQuery(changeRequestDetailBinding, input, resolveIntervalMs);
}

export function useSourceControlChangeRequestDiff(
  input: SourceControlChangeRequestDiffInput,
): SourceControlQueryState<string> {
  return useWatchedQuery(changeRequestDiffBinding, input);
}

export function useSourceControlWorkflowRuns(
  input: SourceControlWorkflowRunsInput,
  resolveIntervalMs?: (data: SourceControlWorkflowRunListResult | null) => number | false,
): SourceControlQueryState<SourceControlWorkflowRunListResult> {
  return useWatchedQuery(workflowRunsBinding, input, resolveIntervalMs);
}

export function useSourceControlWorkflowRunJobs(
  input: SourceControlWorkflowRunJobsInput,
  resolveIntervalMs?: (data: SourceControlWorkflowRunJobsResult | null) => number | false,
): SourceControlQueryState<SourceControlWorkflowRunJobsResult> {
  return useWatchedQuery(workflowRunJobsBinding, input, resolveIntervalMs);
}

function sourceControlQueryStatesEqual<TData>(
  left: SourceControlQueryState<TData>,
  right: SourceControlQueryState<TData>,
): boolean {
  return (
    left.data === right.data &&
    left.isLoading === right.isLoading &&
    left.isFetching === right.isFetching &&
    left.error === right.error
  );
}

export interface SourceControlWorkflowRunJobsBatchResult {
  readonly jobsByRunId: Map<string, SourceControlWorkflowRunJobsResult["jobs"]>;
  readonly isLoading: boolean;
}

export function useSourceControlWorkflowRunJobsBatch(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly runIds: ReadonlyArray<string>;
  readonly activeRunId: string | null;
  readonly enabled: boolean;
}): SourceControlWorkflowRunJobsBatchResult {
  const refreshMode = useSettings((settings) => settings.sourceControlRefreshMode);
  const queryInputs = useMemo(
    () =>
      input.runIds.map((runId): SourceControlWorkflowRunJobsInput => ({
        environmentId: input.environmentId,
        cwd: input.cwd,
        runId,
        enabled: input.enabled,
      })),
    [input.cwd, input.enabled, input.environmentId, input.runIds],
  );
  const targetKeys = useMemo(
    () => queryInputs.map((queryInput) => workflowRunJobsBinding.targetKey(queryInput)),
    [queryInputs],
  );
  const batchSignature = useMemo(() => targetKeys.join("\u0001"), [targetKeys]);
  const queryInputsRef = useRef(queryInputs);
  queryInputsRef.current = queryInputs;
  const snapshotRef = useRef<
    ReadonlyArray<SourceControlQueryState<SourceControlWorkflowRunJobsResult>>
  >([]);

  useEffect(() => {
    const releases = queryInputsRef.current.map((queryInput) =>
      workflowRunJobsBinding.watch(queryInput, {
        resolveIntervalMs: () =>
          resolveSourceControlRefreshDelay({
            mode: refreshMode,
            phase: queryInput.runId === input.activeRunId ? "active" : "settled",
          }),
        shouldRefreshOnLifecycle: ({ hasData, lastFetchedAt, staleTime }) =>
          shouldRefreshSourceControlOnLifecycle({
            mode: refreshMode,
            hasData,
            invalidated: false,
            lastFetchedAtMs: lastFetchedAt,
            staleTimeMs: staleTime,
          }),
      }),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [batchSignature, input.activeRunId, refreshMode]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // The signature intentionally rotates this subscription when the batch
      // membership changes, while the current inputs themselves live in a ref.
      void batchSignature;
      const releases = queryInputsRef.current.map((queryInput) =>
        appAtomRegistry.subscribe(workflowRunJobsBinding.atomFor(queryInput), onStoreChange),
      );
      return () => {
        for (const release of releases) release();
      };
    },
    [batchSignature],
  );

  const getSnapshot = useCallback(() => {
    const next = queryInputsRef.current.map((queryInput) =>
      workflowRunJobsBinding.snapshotFor(queryInput),
    );
    const previous = snapshotRef.current;
    if (
      previous.length === next.length &&
      previous.every((state, index) => sourceControlQueryStatesEqual(state, next[index]!))
    ) {
      return previous;
    }
    snapshotRef.current = next;
    return next;
  }, []);

  const states = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => {
    const jobsByRunId = new Map<string, SourceControlWorkflowRunJobsResult["jobs"]>();
    let isLoading = false;
    input.runIds.forEach((runId, index) => {
      const state = states[index];
      if (!state || state.isLoading || state.data === null) {
        isLoading = input.enabled;
        return;
      }
      jobsByRunId.set(runId, state.data.jobs);
    });
    return { jobsByRunId, isLoading };
  }, [input.enabled, input.runIds, states]);
}

export function useSourceControlWorkflowJobLog(
  input: SourceControlWorkflowJobLogInput,
): SourceControlQueryState<SourceControlWorkflowJobLogResult> {
  return useWatchedQuery(workflowJobLogBinding, input);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface SourceControlMutationResult<TArgs, TResult> {
  readonly mutateAsync: (args: TArgs) => Promise<TResult>;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly reset: () => void;
}

function useSourceControlMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  options?: { readonly onSuccess?: (result: TResult, args: TArgs) => void },
): SourceControlMutationResult<TArgs, TResult> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const fnRef = useRef(mutationFn);
  fnRef.current = mutationFn;
  const onSuccessRef = useRef(options?.onSuccess);
  onSuccessRef.current = options?.onSuccess;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mutateAsync = useCallback(async (args: TArgs): Promise<TResult> => {
    setIsPending(true);
    setError(null);
    try {
      const result = await fnRef.current(args);
      onSuccessRef.current?.(result, args);
      if (mountedRef.current) {
        setIsPending(false);
      }
      return result;
    } catch (rawError) {
      const normalized = rawError instanceof Error ? rawError : new Error("Mutation failed.");
      if (mountedRef.current) {
        setIsPending(false);
        setError(normalized);
      }
      throw normalized;
    }
  }, []);

  const reset = useCallback(() => {
    setIsPending(false);
    setError(null);
  }, []);

  return { mutateAsync, isPending, error, reset };
}

export function useCreateIssueMutation(input: { environmentId: EnvironmentId }) {
  const { environmentId } = input;
  return useSourceControlMutation(
    (payload: SourceControlCreateIssueInput) =>
      requireEnvironmentConnection(environmentId).client.sourceControl.createIssue(payload),
    {
      onSuccess: (_result, payload) => {
        invalidateSourceControl({ environmentId, cwd: payload.cwd });
      },
    },
  );
}

export function useAddIssueCommentMutation(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string;
}) {
  const detailInput: SourceControlIssueDetailInput = {
    environmentId: input.environmentId,
    cwd: input.cwd,
    reference: input.reference,
    fullContent: true,
  };
  const mutation = useSourceControlMutation(
    (payload: Pick<SourceControlAddIssueCommentInput, "body" | "clientMutationId">) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Issue comments are unavailable.");
      }
      return requireEnvironmentConnection(input.environmentId).client.sourceControl.addIssueComment(
        {
          cwd: input.cwd,
          reference: input.reference,
          body: payload.body,
          ...(payload.clientMutationId !== undefined
            ? { clientMutationId: payload.clientMutationId }
            : {}),
        },
      );
    },
    {
      onSuccess: (result) => {
        issueDetailBinding.updateData(detailInput, () => result.detail);
        invalidateSourceControl({ environmentId: input.environmentId, cwd: input.cwd });
      },
    },
  );
  return mutation;
}

export function useAddIssueCommentReactionMutation(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string;
}) {
  const detailInputRef = useRef<SourceControlIssueDetailInput>({
    environmentId: input.environmentId,
    cwd: input.cwd,
    reference: input.reference,
    fullContent: true,
  });
  detailInputRef.current = {
    environmentId: input.environmentId,
    cwd: input.cwd,
    reference: input.reference,
    fullContent: true,
  };
  const baseMutation = useSourceControlMutation(
    (payload: Pick<SourceControlAddCommentReactionInput, "commentId" | "content">) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Comment reactions are unavailable.");
      }
      return requireEnvironmentConnection(
        input.environmentId,
      ).client.sourceControl.addIssueCommentReaction({
        cwd: input.cwd,
        reference: input.reference,
        commentId: payload.commentId,
        content: payload.content,
      });
    },
    {
      onSuccess: (result) => {
        issueDetailBinding.updateData(detailInputRef.current, () => result.detail);
        invalidateSourceControl({ environmentId: input.environmentId, cwd: input.cwd });
      },
    },
  );

  const mutateAsync = useCallback(
    async (
      payload: Pick<SourceControlAddCommentReactionInput, "commentId" | "content">,
    ): Promise<Awaited<ReturnType<typeof baseMutation.mutateAsync>>> => {
      const detailInput = detailInputRef.current;
      const previous = issueDetailBinding.snapshotFor(detailInput).data;
      issueDetailBinding.updateData(
        detailInput,
        (current) => toggleCommentReactionInDetail(current, payload) ?? current,
      );
      try {
        return await baseMutation.mutateAsync(payload);
      } catch (error) {
        issueDetailBinding.updateData(detailInput, () => previous);
        throw error;
      }
    },
    [baseMutation],
  );

  return { ...baseMutation, mutateAsync };
}

export function useAddChangeRequestCommentMutation(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string;
}) {
  const detailInput: SourceControlChangeRequestDetailInput = {
    environmentId: input.environmentId,
    cwd: input.cwd,
    reference: input.reference,
    fullContent: true,
  };
  return useSourceControlMutation(
    (payload: Pick<SourceControlAddChangeRequestCommentInput, "body" | "clientMutationId">) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Pull request comments are unavailable.");
      }
      return requireEnvironmentConnection(
        input.environmentId,
      ).client.sourceControl.addChangeRequestComment({
        cwd: input.cwd,
        reference: input.reference,
        body: payload.body,
        ...(payload.clientMutationId !== undefined
          ? { clientMutationId: payload.clientMutationId }
          : {}),
      });
    },
    {
      onSuccess: (result) => {
        changeRequestDetailBinding.updateData(detailInput, () => result.detail);
        invalidateSourceControl({ environmentId: input.environmentId, cwd: input.cwd });
      },
    },
  );
}

export function useAddChangeRequestCommentReactionMutation(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string;
}) {
  const detailInputRef = useRef<SourceControlChangeRequestDetailInput>({
    environmentId: input.environmentId,
    cwd: input.cwd,
    reference: input.reference,
    fullContent: true,
  });
  detailInputRef.current = {
    environmentId: input.environmentId,
    cwd: input.cwd,
    reference: input.reference,
    fullContent: true,
  };
  const baseMutation = useSourceControlMutation(
    (payload: Pick<SourceControlAddCommentReactionInput, "commentId" | "content">) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Comment reactions are unavailable.");
      }
      return requireEnvironmentConnection(
        input.environmentId,
      ).client.sourceControl.addChangeRequestCommentReaction({
        cwd: input.cwd,
        reference: input.reference,
        commentId: payload.commentId,
        content: payload.content,
      });
    },
    {
      onSuccess: (result) => {
        changeRequestDetailBinding.updateData(detailInputRef.current, () => result.detail);
        invalidateSourceControl({ environmentId: input.environmentId, cwd: input.cwd });
      },
    },
  );

  const mutateAsync = useCallback(
    async (
      payload: Pick<SourceControlAddCommentReactionInput, "commentId" | "content">,
    ): Promise<Awaited<ReturnType<typeof baseMutation.mutateAsync>>> => {
      const detailInput = detailInputRef.current;
      const previous = changeRequestDetailBinding.snapshotFor(detailInput).data;
      changeRequestDetailBinding.updateData(
        detailInput,
        (current) => toggleCommentReactionInDetail(current, payload) ?? current,
      );
      try {
        return await baseMutation.mutateAsync(payload);
      } catch (error) {
        changeRequestDetailBinding.updateData(detailInput, () => previous);
        throw error;
      }
    },
    [baseMutation],
  );

  return { ...baseMutation, mutateAsync };
}

export function useMergeChangeRequestMutation(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string;
}) {
  return useSourceControlMutation(
    (payload: { readonly mergeMethod: SourceControlChangeRequestMergeMethod }) =>
      mergeSourceControlChangeRequest({
        environmentId: input.environmentId,
        cwd: input.cwd,
        reference: input.reference,
        mergeMethod: payload.mergeMethod,
      }),
  );
}

export function useRerunWorkflowMutation(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  runId: string;
}) {
  return useSourceControlMutation(
    (payload: SourceControlWorkflowRerunPayload) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Workflow reruns are unavailable.");
      }
      return requireEnvironmentConnection(input.environmentId).client.sourceControl.rerunWorkflow({
        cwd: input.cwd,
        runId: input.runId,
        ...payload,
      });
    },
    {
      onSuccess: () => {
        invalidateSourceControl({ environmentId: input.environmentId, cwd: input.cwd });
      },
    },
  );
}

export interface GenerateIssueContentPayload {
  readonly cwd: string;
  readonly mode: "polish" | "title";
  readonly rough?: string;
  readonly body?: string;
  readonly currentTitle?: string;
  readonly customInstructions?: string;
}

export function useGenerateIssueContentMutation(input: { environmentId: EnvironmentId }) {
  const { environmentId } = input;
  return useSourceControlMutation((payload: GenerateIssueContentPayload) =>
    requireEnvironmentConnection(environmentId).client.textGeneration.generateIssueContent(payload),
  );
}

export function useGenerateBranchNameMutation(input: { environmentId: EnvironmentId }) {
  const { environmentId } = input;
  return useSourceControlMutation((payload: { cwd: string; message: string }) =>
    requireEnvironmentConnection(environmentId).client.textGeneration.generateBranchName(payload),
  );
}

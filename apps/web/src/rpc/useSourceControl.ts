import { useAtomValue } from "@effect/atom-react";
import type {
  ChangeRequest,
  EnvironmentId,
  SourceControlAssigneeCandidate,
  SourceControlCreateIssueInput,
  SourceControlIssueSummary,
  SourceControlLabel,
} from "@ryco/contracts";
import { useQueryClient } from "./queryClient";
import { useCallback, useEffect, useRef, useState } from "react";

import { requireEnvironmentConnection } from "~/environments/runtime";
import { sourceControlContextQueryKeys } from "~/lib/sourceControlContextRpc";
import {
  changeRequestListBinding,
  changeRequestSearchBinding,
  invalidateSourceControl,
  issueAssigneesBinding,
  issueLabelsBinding,
  issueListBinding,
  issueSearchBinding,
  type QueryBinding,
  type SourceControlChangeRequestListInput,
  type SourceControlChangeRequestSearchInput,
  type SourceControlIssueListInput,
  type SourceControlIssueMetaInput,
  type SourceControlIssueSearchInput,
  type SourceControlQueryState,
} from "./sourceControlAtoms";

export {
  fetchSourceControlChangeRequestDetail,
  fetchSourceControlIssueDetail,
  invalidateSourceControl,
  type SourceControlQueryState,
} from "./sourceControlAtoms";

// ---------------------------------------------------------------------------
// Reactive read hooks (atom-backed replacements for the former
// `useQuery(*QueryOptions(...))` source-control reads).
// ---------------------------------------------------------------------------

function useWatchedQuery<TInput, TData>(
  binding: QueryBinding<TInput, TData>,
  input: TInput,
): SourceControlQueryState<TData> {
  const targetKey = binding.targetKey(input);
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => binding.watch(inputRef.current), [binding, targetKey]);

  return useAtomValue(binding.atomFor(input));
}

export function useSourceControlIssueList(
  input: SourceControlIssueListInput,
): SourceControlQueryState<ReadonlyArray<SourceControlIssueSummary>> {
  return useWatchedQuery(issueListBinding, input);
}

export function useSourceControlChangeRequestList(
  input: SourceControlChangeRequestListInput,
): SourceControlQueryState<ReadonlyArray<ChangeRequest>> {
  return useWatchedQuery(changeRequestListBinding, input);
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
  // React Query is still the source of truth for issue lists rendered outside
  // this migration's scope (e.g. `IssuesTab`, `ProjectOverviewTab`). Invalidate
  // both caches so a freshly created issue shows up everywhere during the
  // transition.
  const queryClient = useQueryClient();
  return useSourceControlMutation(
    (payload: SourceControlCreateIssueInput) =>
      requireEnvironmentConnection(environmentId).client.sourceControl.createIssue(payload),
    {
      onSuccess: (_result, payload) => {
        invalidateSourceControl({ environmentId, cwd: payload.cwd });
        void queryClient.invalidateQueries({ queryKey: sourceControlContextQueryKeys.all });
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

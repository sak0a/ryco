import type {
  EnvironmentId,
  SourceControlAddChangeRequestCommentInput,
  SourceControlAddIssueCommentInput,
} from "@ryco/contracts";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { requireEnvironmentConnection } from "~/environments/runtime";

type SourceControlWorkflowRerunPayload =
  | { readonly target: "failed-jobs" }
  | { readonly target: "job"; readonly jobId: string };

export const sourceControlContextQueryKeys = {
  all: ["sourceControl"] as const,
  issueList: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    state: "open" | "closed" | "all",
    limit?: number,
  ) =>
    ["sourceControl", "issues", environmentId ?? null, cwd, "list", state, limit ?? null] as const,
  issueDetail: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    reference: string,
    fullContent: boolean = false,
  ) =>
    [
      "sourceControl",
      "issues",
      environmentId ?? null,
      cwd,
      "detail",
      reference,
      fullContent ? "full" : "truncated",
    ] as const,
  issueSearch: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    query: string,
    limit?: number,
  ) =>
    [
      "sourceControl",
      "issues",
      environmentId ?? null,
      cwd,
      "search",
      query,
      limit ?? null,
    ] as const,
  changeRequestList: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    state: "open" | "closed" | "merged" | "all",
    limit?: number,
  ) =>
    [
      "sourceControl",
      "changeRequests",
      environmentId ?? null,
      cwd,
      "list",
      state,
      limit ?? null,
    ] as const,
  changeRequestDetail: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    reference: string,
    fullContent: boolean = false,
  ) =>
    [
      "sourceControl",
      "changeRequests",
      environmentId ?? null,
      cwd,
      "detail",
      reference,
      fullContent ? "full" : "truncated",
    ] as const,
  changeRequestDiff: (environmentId: EnvironmentId | null, cwd: string | null, reference: string) =>
    ["sourceControl", "changeRequests", environmentId ?? null, cwd, "diff", reference] as const,
  changeRequestSearch: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    query: string,
    limit?: number,
  ) =>
    [
      "sourceControl",
      "changeRequests",
      environmentId ?? null,
      cwd,
      "search",
      query,
      limit ?? null,
    ] as const,
  workflowRuns: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    pullRequestNumber?: number | null,
    limit?: number,
  ) =>
    [
      "sourceControl",
      "workflows",
      environmentId ?? null,
      cwd,
      "runs",
      pullRequestNumber ?? null,
      limit ?? null,
    ] as const,
  workflows: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["sourceControl", "workflows", environmentId ?? null, cwd] as const,
  workflowRunJobs: (environmentId: EnvironmentId | null, cwd: string | null, runId: string) =>
    ["sourceControl", "workflows", environmentId ?? null, cwd, "jobs", runId] as const,
  workflowJobLog: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    runId: string,
    jobId: string,
  ) => ["sourceControl", "workflows", environmentId ?? null, cwd, "logs", runId, jobId] as const,
};

export function issueListQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  state: "open" | "closed" | "all";
  limit?: number;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: sourceControlContextQueryKeys.issueList(
      input.environmentId,
      input.cwd,
      input.state,
      input.limit,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Issue list is unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.listIssues({
        cwd: input.cwd,
        state: input.state,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: 60_000,
  });
}

export function issueDetailQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string | null;
  fullContent?: boolean;
  enabled?: boolean;
}) {
  const fullContent = input.fullContent ?? false;
  return queryOptions({
    queryKey: sourceControlContextQueryKeys.issueDetail(
      input.environmentId,
      input.cwd,
      input.reference ?? "",
      fullContent,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || !input.reference) {
        throw new Error("Issue detail is unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.getIssue({
        cwd: input.cwd,
        reference: input.reference,
        ...(fullContent ? { fullContent: true } : {}),
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.reference !== null,
    staleTime: 300_000,
  });
}

export function searchIssuesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  query: string;
  limit?: number;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: sourceControlContextQueryKeys.issueSearch(
      input.environmentId,
      input.cwd,
      input.query,
      input.limit,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Issue search is unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.searchIssues({
        cwd: input.cwd,
        query: input.query,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.query.length > 0,
    staleTime: 30_000,
  });
}

export function changeRequestListQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  state: "open" | "closed" | "merged" | "all";
  limit?: number;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: sourceControlContextQueryKeys.changeRequestList(
      input.environmentId,
      input.cwd,
      input.state,
      input.limit,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Change request list is unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.listChangeRequests({
        cwd: input.cwd,
        state: input.state,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: 60_000,
  });
}

export function searchChangeRequestsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  query: string;
  limit?: number;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: sourceControlContextQueryKeys.changeRequestSearch(
      input.environmentId,
      input.cwd,
      input.query,
      input.limit,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Change request search is unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.searchChangeRequests({
        cwd: input.cwd,
        query: input.query,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.query.length > 0,
    staleTime: 30_000,
  });
}

export function changeRequestDiffQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: sourceControlContextQueryKeys.changeRequestDiff(
      input.environmentId,
      input.cwd,
      input.reference ?? "",
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || !input.reference) {
        throw new Error("Change request diff is unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.getChangeRequestDiff({
        cwd: input.cwd,
        reference: input.reference,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.reference !== null,
    staleTime: 300_000,
  });
}

export function changeRequestDetailQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string | null;
  fullContent?: boolean;
  enabled?: boolean;
}) {
  const fullContent = input.fullContent ?? false;
  return queryOptions({
    queryKey: sourceControlContextQueryKeys.changeRequestDetail(
      input.environmentId,
      input.cwd,
      input.reference ?? "",
      fullContent,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || !input.reference) {
        throw new Error("Change request detail is unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.getChangeRequestDetail({
        cwd: input.cwd,
        reference: input.reference,
        ...(fullContent ? { fullContent: true } : {}),
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.reference !== null,
    staleTime: 300_000,
  });
}

export function workflowRunsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  pullRequestNumber?: number | null;
  limit?: number;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: sourceControlContextQueryKeys.workflowRuns(
      input.environmentId,
      input.cwd,
      input.pullRequestNumber,
      input.limit,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Workflow runs are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.listWorkflowRuns({
        cwd: input.cwd,
        ...(input.pullRequestNumber !== undefined && input.pullRequestNumber !== null
          ? { pullRequestNumber: input.pullRequestNumber }
          : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: 60_000,
  });
}

export function workflowRunJobsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  runId: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: sourceControlContextQueryKeys.workflowRunJobs(
      input.environmentId,
      input.cwd,
      input.runId ?? "",
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || !input.runId) {
        throw new Error("Workflow jobs are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.getWorkflowRunJobs({ cwd: input.cwd, runId: input.runId });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.runId !== null,
    staleTime: 60_000,
  });
}

export function workflowJobLogQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  runId: string | null;
  jobId: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: sourceControlContextQueryKeys.workflowJobLog(
      input.environmentId,
      input.cwd,
      input.runId ?? "",
      input.jobId ?? "",
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || !input.runId || !input.jobId) {
        throw new Error("Workflow logs are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.getWorkflowJobLog({
        cwd: input.cwd,
        runId: input.runId,
        jobId: input.jobId,
      });
    },
    enabled:
      (input.enabled ?? false) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.runId !== null &&
      input.jobId !== null,
    staleTime: 300_000,
  });
}

export function useRerunWorkflowMutation(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  runId: string;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SourceControlWorkflowRerunPayload) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Workflow reruns are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.rerunWorkflow({
        cwd: input.cwd,
        runId: input.runId,
        ...payload,
      });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({
        queryKey: sourceControlContextQueryKeys.workflows(input.environmentId, input.cwd),
      });
      qc.invalidateQueries({
        queryKey: sourceControlContextQueryKeys.workflowRunJobs(
          input.environmentId,
          input.cwd,
          result.runId,
        ),
      });
    },
  });
}

export function useAddIssueCommentMutation(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: Pick<SourceControlAddIssueCommentInput, "body" | "clientMutationId">,
    ) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Issue comments are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.addIssueComment({
        cwd: input.cwd,
        reference: input.reference,
        body: payload.body,
        ...(payload.clientMutationId !== undefined
          ? { clientMutationId: payload.clientMutationId }
          : {}),
      });
    },
    onSuccess: (result) => {
      qc.setQueryData(
        sourceControlContextQueryKeys.issueDetail(
          input.environmentId,
          input.cwd,
          input.reference,
          true,
        ),
        result.detail,
      );
      qc.invalidateQueries({
        queryKey: sourceControlContextQueryKeys.all,
      });
    },
  });
}

export function useAddChangeRequestCommentMutation(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: Pick<SourceControlAddChangeRequestCommentInput, "body" | "clientMutationId">,
    ) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Pull request comments are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.addChangeRequestComment({
        cwd: input.cwd,
        reference: input.reference,
        body: payload.body,
        ...(payload.clientMutationId !== undefined
          ? { clientMutationId: payload.clientMutationId }
          : {}),
      });
    },
    onSuccess: (result) => {
      qc.setQueryData(
        sourceControlContextQueryKeys.changeRequestDetail(
          input.environmentId,
          input.cwd,
          input.reference,
          true,
        ),
        result.detail,
      );
      qc.invalidateQueries({
        queryKey: sourceControlContextQueryKeys.all,
      });
    },
  });
}

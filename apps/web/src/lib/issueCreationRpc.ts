import type {
  EnvironmentId,
  SourceControlAssigneeCandidate,
  SourceControlCreateIssueInput,
  SourceControlLabel,
} from "@ryco/contracts";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { requireEnvironmentConnection } from "~/environments/runtime";
import { sourceControlContextQueryKeys } from "./sourceControlContextRpc";

export const issueCreationQueryKeys = {
  labels: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["sourceControl", "issueLabels", environmentId ?? null, cwd] as const,
  assignees: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["sourceControl", "issueAssignees", environmentId ?? null, cwd] as const,
};

export function buildIssueLabelsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}) {
  return queryOptions({
    queryKey: issueCreationQueryKeys.labels(input.environmentId, input.cwd),
    queryFn: async (): Promise<ReadonlyArray<SourceControlLabel>> => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Issue labels are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.listIssueLabels({ cwd: input.cwd });
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: 5 * 60_000,
  });
}

export function buildIssueAssigneesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}) {
  return queryOptions({
    queryKey: issueCreationQueryKeys.assignees(input.environmentId, input.cwd),
    queryFn: async (): Promise<ReadonlyArray<SourceControlAssigneeCandidate>> => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Issue assignees are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.listIssueAssignees({ cwd: input.cwd });
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: 5 * 60_000,
  });
}

export function useCreateIssueMutation(input: { environmentId: EnvironmentId }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SourceControlCreateIssueInput) => {
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.createIssue(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: sourceControlContextQueryKeys.all,
      });
    },
  });
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
  return useMutation({
    mutationFn: (payload: GenerateIssueContentPayload) => {
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.textGeneration.generateIssueContent(payload);
    },
  });
}

export function useGenerateBranchNameMutation(input: { environmentId: EnvironmentId }) {
  return useMutation({
    mutationFn: (payload: { cwd: string; message: string }) => {
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.textGeneration.generateBranchName(payload);
    },
  });
}

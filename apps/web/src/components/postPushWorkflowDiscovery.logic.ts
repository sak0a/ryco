import type { EnvironmentId, SourceControlWorkflowRun } from "@ryco/contracts";
import type { SourceControlRefreshMode } from "@ryco/contracts/settings";
import {
  AUTOMATIC_ACTIVE_REFRESH_MS,
  AUTOMATIC_DISCOVERY_REFRESH_MS,
  POST_PUSH_DISCOVERY_WINDOW_MS,
  resolveSourceControlRefreshDelay,
} from "~/rpc/sourceControlRefreshPolicy";

export const POST_PUSH_WORKFLOW_DISCOVERY_INTERVAL_MS = AUTOMATIC_DISCOVERY_REFRESH_MS;
export const POST_PUSH_WORKFLOW_DISCOVERY_WINDOW_MS = POST_PUSH_DISCOVERY_WINDOW_MS;
export const ACTIVE_WORKFLOW_REFRESH_INTERVAL_MS = AUTOMATIC_ACTIVE_REFRESH_MS;

export interface PostPushWorkflowDiscoveryWatch {
  readonly environmentId: EnvironmentId;
  readonly threadKey: string | null;
  readonly cwd: string;
  readonly pullRequestNumber: number | null;
  readonly commitSha: string | null;
  readonly expiresAtMs: number;
}

export function createPostPushWorkflowDiscoveryWatch(input: {
  readonly environmentId: EnvironmentId;
  readonly threadKey?: string | null;
  readonly cwd: string;
  readonly pullRequestNumber?: number | null;
  readonly commitSha?: string | null;
  readonly nowMs: number;
}): PostPushWorkflowDiscoveryWatch {
  return {
    environmentId: input.environmentId,
    threadKey: input.threadKey ?? null,
    cwd: input.cwd,
    pullRequestNumber: input.pullRequestNumber ?? null,
    commitSha: input.commitSha?.trim() || null,
    expiresAtMs: input.nowMs + POST_PUSH_WORKFLOW_DISCOVERY_WINDOW_MS,
  };
}

export function selectActivePostPushWorkflowDiscoveryWatch(input: {
  readonly watch: PostPushWorkflowDiscoveryWatch | null;
  readonly environmentId: EnvironmentId | null;
  readonly threadKey: string | null;
  readonly cwd: string | null;
  readonly pullRequestNumber: number | null;
  readonly nowMs: number;
}): PostPushWorkflowDiscoveryWatch | null {
  const { watch } = input;
  if (!watch || !input.environmentId || !input.cwd) return null;
  if (input.nowMs >= watch.expiresAtMs) return null;
  if (watch.environmentId !== input.environmentId || watch.cwd !== input.cwd) return null;
  if (watch.threadKey !== null && watch.threadKey !== input.threadKey) return null;
  if (
    watch.pullRequestNumber !== null &&
    input.pullRequestNumber !== null &&
    watch.pullRequestNumber !== input.pullRequestNumber
  ) {
    return null;
  }
  return watch;
}

export function hasDiscoveredPostPushWorkflowRun(input: {
  readonly watch: PostPushWorkflowDiscoveryWatch | null;
  readonly runs: ReadonlyArray<SourceControlWorkflowRun> | null | undefined;
}): boolean {
  if (!input.watch || !input.runs || input.runs.length === 0) return false;
  const commitSha = input.watch.commitSha;
  if (!commitSha) return false;
  return input.runs.some((run) => {
    const oid = run.commit.oid;
    return oid === commitSha || oid.startsWith(commitSha) || commitSha.startsWith(oid);
  });
}

export function resolveWorkflowRunsRefetchInterval(input: {
  readonly mode?: SourceControlRefreshMode;
  readonly activeWatch: PostPushWorkflowDiscoveryWatch | null;
  readonly nowMs: number;
  readonly discoveredPostPushRun: boolean;
  readonly statusRefreshable: boolean;
}): number | false {
  if (
    input.activeWatch &&
    input.nowMs < input.activeWatch.expiresAtMs &&
    !input.discoveredPostPushRun
  ) {
    return resolveSourceControlRefreshDelay({
      mode: input.mode ?? "automatic",
      phase: "discovery",
      nowMs: input.nowMs,
      discoveryExpiresAtMs: input.activeWatch.expiresAtMs,
    });
  }

  return resolveSourceControlRefreshDelay({
    mode: input.mode ?? "automatic",
    phase: input.statusRefreshable ? "active" : "settled",
  });
}

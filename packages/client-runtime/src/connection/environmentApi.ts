import type { EnvironmentApi, EnvironmentId } from "@ryco/contracts";

import type { WsRpcClient } from "../rpc/index.ts";

export function createEnvironmentApi(rpcClient: WsRpcClient): EnvironmentApi {
  return {
    terminal: {
      open: (input) => rpcClient.terminal.open(input as never),
      write: (input) => rpcClient.terminal.write(input as never),
      resize: (input) => rpcClient.terminal.resize(input as never),
      clear: (input) => rpcClient.terminal.clear(input as never),
      restart: (input) => rpcClient.terminal.restart(input as never),
      close: (input) => rpcClient.terminal.close(input as never),
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      listEntries: rpcClient.projects.listEntries,
      readFile: rpcClient.projects.readFile,
      searchEntries: rpcClient.projects.searchEntries,
      writeFile: rpcClient.projects.writeFile,
      stageFileReference: rpcClient.projects.stageFileReference,
      initializeGit: rpcClient.projects.initializeGit,
    },
    filesystem: { browse: rpcClient.filesystem.browse },
    sourceControl: {
      lookupRepository: rpcClient.sourceControl.lookupRepository,
      searchRepositories: rpcClient.sourceControl.searchRepositories,
      cloneRepository: rpcClient.sourceControl.cloneRepository,
      publishRepository: rpcClient.sourceControl.publishRepository,
    },
    vcs: {
      pull: rpcClient.vcs.pull,
      refreshStatus: rpcClient.vcs.refreshStatus,
      onStatus: (input, callback, options) => rpcClient.vcs.onStatus(input, callback, options),
      listRefs: rpcClient.vcs.listRefs,
      createWorktree: rpcClient.vcs.createWorktree,
      removeWorktree: rpcClient.vcs.removeWorktree,
      createRef: rpcClient.vcs.createRef,
      switchRef: rpcClient.vcs.switchRef,
      init: rpcClient.vcs.init,
    },
    git: {
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
      createWorktreeForProject: rpcClient.git.createWorktreeForProject,
      findWorktreeForOrigin: rpcClient.git.findWorktreeForOrigin,
      archiveWorktree: rpcClient.git.archiveWorktree,
      restoreWorktree: rpcClient.git.restoreWorktree,
      deleteWorktree: rpcClient.git.deleteWorktree,
    },
    ...(rpcClient.worktrees
      ? {
          worktrees: {
            setManualPosition: rpcClient.worktrees.setManualPosition,
          },
        }
      : {}),
    ...(rpcClient.threads
      ? {
          threads: {
            setManualBucket: rpcClient.threads.setManualBucket,
            setManualPosition: rpcClient.threads.setManualPosition,
          },
        }
      : {}),
    orchestration: {
      dispatchCommand: rpcClient.orchestration.dispatchCommand,
      getTurnDiff: rpcClient.orchestration.getTurnDiff,
      getWorkflowScript: rpcClient.orchestration.getWorkflowScript,
      getFullThreadDiff: rpcClient.orchestration.getFullThreadDiff,
      searchThreadMessages: rpcClient.orchestration.searchThreadMessages,
      subscribeShell: (callback, options) =>
        rpcClient.orchestration.subscribeShell(callback, options),
      subscribeThread: (input, callback, options) =>
        rpcClient.orchestration.subscribeThread(input, callback, options),
    },
    contextHandoff: {
      getInspectionSummary: rpcClient.contextHandoff.getInspectionSummary,
      listInspectionEntries: rpcClient.contextHandoff.listInspectionEntries,
      readRawPayloadChunk: rpcClient.contextHandoff.readRawPayloadChunk,
      readExportChunk: rpcClient.contextHandoff.readExportChunk,
    },
  };
}

export function createEnvironmentApiLookup(input: {
  readonly canReadConnections: () => boolean;
  readonly readClient: (environmentId: EnvironmentId) => WsRpcClient | null;
}) {
  return {
    read: (environmentId: EnvironmentId): EnvironmentApi | undefined => {
      if (!input.canReadConnections() || !environmentId) return undefined;
      const client = input.readClient(environmentId);
      return client ? createEnvironmentApi(client) : undefined;
    },
  };
}

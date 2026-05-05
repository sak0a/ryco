import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type VcsStatusResult,
  type VcsStatusStreamEvent,
  type LocalApi,
  ORCHESTRATION_WS_METHODS,
  type OpinionatedPluginCheckInput,
  type OpinionatedPluginInstallInput,
  type ServerSettingsPatch,
  WS_METHODS,
} from "@ryco/contracts";
import { applyGitStatusStreamEvent } from "@ryco/shared/git";
import { Effect, Stream } from "effect";

import { type WsRpcProtocolClient } from "./protocol";
import { resetWsReconnectBackoff } from "./wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

type RpcInputStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (
        input: RpcInput<TTag>,
        listener: (event: TEvent) => void,
        options?: StreamSubscriptionOptions,
      ) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly listEntries: RpcUnaryMethod<typeof WS_METHODS.projectsListEntries>;
    readonly readFile: RpcUnaryMethod<typeof WS_METHODS.projectsReadFile>;
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
    readonly initializeGit: RpcUnaryMethod<typeof WS_METHODS.projectsInitializeGit>;
  };
  readonly filesystem: {
    readonly browse: RpcUnaryMethod<typeof WS_METHODS.filesystemBrowse>;
  };
  readonly sourceControl: {
    readonly lookupRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlLookupRepository>;
    readonly cloneRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlCloneRepository>;
    readonly publishRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlPublishRepository>;
    readonly listIssues: RpcUnaryMethod<typeof WS_METHODS.sourceControlListIssues>;
    readonly getIssue: RpcUnaryMethod<typeof WS_METHODS.sourceControlGetIssue>;
    readonly searchIssues: RpcUnaryMethod<typeof WS_METHODS.sourceControlSearchIssues>;
    readonly listChangeRequests: RpcUnaryMethod<typeof WS_METHODS.sourceControlListChangeRequests>;
    readonly searchChangeRequests: RpcUnaryMethod<
      typeof WS_METHODS.sourceControlSearchChangeRequests
    >;
    readonly getChangeRequestDetail: RpcUnaryMethod<
      typeof WS_METHODS.sourceControlGetChangeRequestDetail
    >;
    readonly getChangeRequestDiff: RpcUnaryMethod<
      typeof WS_METHODS.sourceControlGetChangeRequestDiff
    >;
  };
  readonly atlassian: {
    readonly listConnections: RpcUnaryNoArgMethod<typeof WS_METHODS.atlassianListConnections>;
    readonly startOAuth: RpcUnaryMethod<typeof WS_METHODS.atlassianStartOAuth>;
    readonly disconnect: RpcUnaryMethod<typeof WS_METHODS.atlassianDisconnect>;
    readonly refresh: RpcUnaryMethod<typeof WS_METHODS.atlassianRefresh>;
    readonly listResources: RpcUnaryMethod<typeof WS_METHODS.atlassianListResources>;
    readonly getProjectLink: RpcUnaryMethod<typeof WS_METHODS.atlassianGetProjectLink>;
    readonly saveProjectLink: RpcUnaryMethod<typeof WS_METHODS.atlassianSaveProjectLink>;
    readonly saveManualBitbucketToken: RpcUnaryMethod<
      typeof WS_METHODS.atlassianSaveManualBitbucketToken
    >;
    readonly saveManualJiraToken: RpcUnaryMethod<typeof WS_METHODS.atlassianSaveManualJiraToken>;
  };
  readonly workItems: {
    readonly list: RpcUnaryMethod<typeof WS_METHODS.workItemsList>;
    readonly search: RpcUnaryMethod<typeof WS_METHODS.workItemsSearch>;
    readonly get: RpcUnaryMethod<typeof WS_METHODS.workItemsGet>;
    readonly addComment: RpcUnaryMethod<typeof WS_METHODS.workItemsAddComment>;
    readonly listTransitions: RpcUnaryMethod<typeof WS_METHODS.workItemsListTransitions>;
    readonly transition: RpcUnaryMethod<typeof WS_METHODS.workItemsTransition>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly vcs: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.vcsPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.vcsRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeVcsStatus>,
      listener: (status: VcsStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly listRefs: RpcUnaryMethod<typeof WS_METHODS.vcsListRefs>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsRemoveWorktree>;
    readonly createRef: RpcUnaryMethod<typeof WS_METHODS.vcsCreateRef>;
    readonly switchRef: RpcUnaryMethod<typeof WS_METHODS.vcsSwitchRef>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.vcsInit>;
  };
  /**
   * Git-specific workflows. Local repository mechanics live under `vcs`.
   */
  readonly git: {
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
    readonly createWorktreeForProject: RpcUnaryMethod<
      typeof WS_METHODS.gitCreateWorktreeForProject
    >;
    readonly findWorktreeForOrigin: RpcUnaryMethod<typeof WS_METHODS.gitFindWorktreeForOrigin>;
    readonly archiveWorktree: RpcUnaryMethod<typeof WS_METHODS.gitArchiveWorktree>;
    readonly restoreWorktree: RpcUnaryMethod<typeof WS_METHODS.gitRestoreWorktree>;
    readonly deleteWorktree: RpcUnaryMethod<typeof WS_METHODS.gitDeleteWorktree>;
  };
  readonly worktrees: {
    readonly setManualPosition: RpcUnaryMethod<typeof WS_METHODS.worktreesSetManualPosition>;
  };
  readonly threads: {
    readonly setManualBucket: RpcUnaryMethod<typeof WS_METHODS.threadsSetManualBucket>;
    readonly setManualPosition: RpcUnaryMethod<typeof WS_METHODS.threadsSetManualPosition>;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    /**
     * Refresh provider snapshots. Pass `{ instanceId }` to refresh a single
     * configured instance; pass no argument (or `{}`) to refresh all.
     */
    readonly refreshProviders: (
      input?: RpcInput<typeof WS_METHODS.serverRefreshProviders>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverRefreshProviders>>;
    readonly updateProvider: RpcUnaryMethod<typeof WS_METHODS.serverUpdateProvider>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly discoverSourceControl: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverDiscoverSourceControl
    >;
    readonly listOpinionatedPlugins: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverListOpinionatedPlugins
    >;
    readonly checkOpinionatedPlugins: (
      input?: OpinionatedPluginCheckInput,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverCheckOpinionatedPlugins>>;
    readonly installOpinionatedPlugin: (
      input: OpinionatedPluginInstallInput,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverInstallOpinionatedPlugin>>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
  };
  readonly mcp: {
    readonly listWorkspaces: RpcUnaryNoArgMethod<typeof WS_METHODS.mcpListWorkspaces>;
    readonly listServers: RpcUnaryMethod<typeof WS_METHODS.mcpListServers>;
    readonly upsertServer: RpcUnaryMethod<typeof WS_METHODS.mcpUpsertServer>;
    readonly setServerEnabled: RpcUnaryMethod<typeof WS_METHODS.mcpSetServerEnabled>;
    readonly removeServer: RpcUnaryMethod<typeof WS_METHODS.mcpRemoveServer>;
    readonly reloadServers: RpcUnaryMethod<typeof WS_METHODS.mcpReloadServers>;
    readonly startOauthLogin: RpcUnaryMethod<typeof WS_METHODS.mcpStartOauthLogin>;
  };
  readonly orchestration: {
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly subscribeShell: RpcStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeShell>;
    readonly subscribeThread: RpcInputStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeThread>;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeTerminalEvents]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeTerminalEvents,
        }),
    },
    projects: {
      listEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsListEntries](input)),
      readFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsReadFile](input)),
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
      initializeGit: (input) =>
        transport.request((client) => client[WS_METHODS.projectsInitializeGit](input)),
    },
    filesystem: {
      browse: (input) => transport.request((client) => client[WS_METHODS.filesystemBrowse](input)),
    },
    sourceControl: {
      lookupRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlLookupRepository](input)),
      cloneRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlCloneRepository](input)),
      publishRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlPublishRepository](input)),
      listIssues: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlListIssues](input)),
      getIssue: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlGetIssue](input)),
      searchIssues: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlSearchIssues](input)),
      listChangeRequests: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlListChangeRequests](input)),
      searchChangeRequests: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlSearchChangeRequests](input)),
      getChangeRequestDetail: (input) =>
        transport.request((client) =>
          client[WS_METHODS.sourceControlGetChangeRequestDetail](input),
        ),
      getChangeRequestDiff: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlGetChangeRequestDiff](input)),
    },
    atlassian: {
      listConnections: () =>
        transport.request((client) => client[WS_METHODS.atlassianListConnections]({})),
      startOAuth: (input) =>
        transport.request((client) => client[WS_METHODS.atlassianStartOAuth](input)),
      disconnect: (input) =>
        transport.request((client) => client[WS_METHODS.atlassianDisconnect](input)),
      refresh: (input) => transport.request((client) => client[WS_METHODS.atlassianRefresh](input)),
      listResources: (input) =>
        transport.request((client) => client[WS_METHODS.atlassianListResources](input)),
      getProjectLink: (input) =>
        transport.request((client) => client[WS_METHODS.atlassianGetProjectLink](input)),
      saveProjectLink: (input) =>
        transport.request((client) => client[WS_METHODS.atlassianSaveProjectLink](input)),
      saveManualBitbucketToken: (input) =>
        transport.request((client) => client[WS_METHODS.atlassianSaveManualBitbucketToken](input)),
      saveManualJiraToken: (input) =>
        transport.request((client) => client[WS_METHODS.atlassianSaveManualJiraToken](input)),
    },
    workItems: {
      list: (input) => transport.request((client) => client[WS_METHODS.workItemsList](input)),
      search: (input) => transport.request((client) => client[WS_METHODS.workItemsSearch](input)),
      get: (input) => transport.request((client) => client[WS_METHODS.workItemsGet](input)),
      addComment: (input) =>
        transport.request((client) => client[WS_METHODS.workItemsAddComment](input)),
      listTransitions: (input) =>
        transport.request((client) => client[WS_METHODS.workItemsListTransitions](input)),
      transition: (input) =>
        transport.request((client) => client[WS_METHODS.workItemsTransition](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    vcs: {
      pull: (input) => transport.request((client) => client[WS_METHODS.vcsPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: VcsStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeVcsStatus](input),
          (event: VcsStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          { ...options, tag: WS_METHODS.subscribeVcsStatus },
        );
      },
      listRefs: (input) => transport.request((client) => client[WS_METHODS.vcsListRefs](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRemoveWorktree](input)),
      createRef: (input) => transport.request((client) => client[WS_METHODS.vcsCreateRef](input)),
      switchRef: (input) => transport.request((client) => client[WS_METHODS.vcsSwitchRef](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.vcsInit](input)),
    },
    git: {
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
      createWorktreeForProject: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateWorktreeForProject](input)),
      findWorktreeForOrigin: (input) =>
        transport.request((client) => client[WS_METHODS.gitFindWorktreeForOrigin](input)),
      archiveWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitArchiveWorktree](input)),
      restoreWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitRestoreWorktree](input)),
      deleteWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitDeleteWorktree](input)),
    },
    worktrees: {
      setManualPosition: (input) =>
        transport.request((client) => client[WS_METHODS.worktreesSetManualPosition](input)),
    },
    threads: {
      setManualBucket: (input) =>
        transport.request((client) => client[WS_METHODS.threadsSetManualBucket](input)),
      setManualPosition: (input) =>
        transport.request((client) => client[WS_METHODS.threadsSetManualPosition](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: (input) =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders](input ?? {})),
      updateProvider: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpdateProvider](input)),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      discoverSourceControl: () =>
        transport.request((client) => client[WS_METHODS.serverDiscoverSourceControl]({})),
      listOpinionatedPlugins: () =>
        transport.request((client) => client[WS_METHODS.serverListOpinionatedPlugins]({})),
      checkOpinionatedPlugins: (input) =>
        transport.request((client) =>
          client[WS_METHODS.serverCheckOpinionatedPlugins](input ?? {}),
        ),
      installOpinionatedPlugin: (input) =>
        transport.request((client) => client[WS_METHODS.serverInstallOpinionatedPlugin](input)),
      subscribeConfig: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeServerConfig]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeServerConfig,
        }),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeServerLifecycle]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeServerLifecycle,
        }),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeAuthAccess]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeAuthAccess,
        }),
    },
    mcp: {
      listWorkspaces: () => transport.request((client) => client[WS_METHODS.mcpListWorkspaces]({})),
      listServers: (input) =>
        transport.request((client) => client[WS_METHODS.mcpListServers](input)),
      upsertServer: (input) =>
        transport.request((client) => client[WS_METHODS.mcpUpsertServer](input)),
      setServerEnabled: (input) =>
        transport.request((client) => client[WS_METHODS.mcpSetServerEnabled](input)),
      removeServer: (input) =>
        transport.request((client) => client[WS_METHODS.mcpRemoveServer](input)),
      reloadServers: (input) =>
        transport.request((client) => client[WS_METHODS.mcpReloadServers](input)),
      startOauthLogin: (input) =>
        transport.request((client) => client[WS_METHODS.mcpStartOauthLogin](input)),
    },
    orchestration: {
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      subscribeShell: (listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
          listener,
          { ...options, tag: ORCHESTRATION_WS_METHODS.subscribeShell },
        ),
      subscribeThread: (input, listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeThread](input),
          listener,
          { ...options, tag: ORCHESTRATION_WS_METHODS.subscribeThread },
        ),
    },
  };
}

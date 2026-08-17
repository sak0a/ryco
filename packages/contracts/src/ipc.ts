import type {
  GitArchiveWorktreeInput,
  GitCreateWorktreeForProjectInput,
  GitCreateWorktreeForProjectOutput,
  GitDeleteWorktreeInput,
  GitFindWorktreeForOriginInput,
  GitFindWorktreeForOriginOutput,
  GitRestoreWorktreeInput,
  ProjectsInitializeGitInput,
  ThreadsSetManualBucketInput,
  ThreadsSetManualPositionInput,
  WorktreesSetManualPositionInput,
  EmptyRpcResult,
} from "./rpc.ts";
import type {
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  VcsCreateRefInput,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsPullInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  VcsStatusInput,
  VcsStatusResult,
  VcsCreateRefResult,
} from "./git.ts";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem.ts";
import type {
  McpListServersInput,
  McpListServersResult,
  McpListWorkspacesResult,
  McpOauthLoginInput,
  McpOauthLoginResult,
  McpServerEnabledInput,
  McpServerRemoveInput,
  McpServerUpsertInput,
  McpServersReloadInput,
} from "./mcp.ts";
import type {
  OpinionatedPluginCheckInput,
  OpinionatedPluginInstallInput,
  OpinionatedPluginInstallResult,
  OpinionatedPluginListResult,
  OpinionatedPluginStatusResult,
} from "./opinionatedPlugins.ts";
import type {
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectReadFileBinaryInput,
  ProjectReadFileBinaryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectStageFileReferenceInput,
  ProjectStageFileReferenceResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import type { ProviderInstanceId } from "./providerInstance.ts";
import type {
  ServerConfig,
  ServerLocalDiagnosticsMetrics,
  ServerProviderUpdateInput,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingResult,
  KeybindingsReplaceCustomInput,
  KeybindingsReplaceCustomResult,
} from "./server.ts";
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import type { ServerUpsertKeybindingInput } from "./server.ts";
import type {
  ClientOrchestrationCommand,
  ContextHandoffExportChunk,
  ContextHandoffExportChunkInput,
  ContextHandoffInspectionEntriesInput,
  ContextHandoffInspectionEntriesPage,
  ContextHandoffInspectionSummary,
  ContextHandoffInspectionSummaryInput,
  ContextHandoffRawPayloadChunk,
  ContextHandoffRawPayloadChunkInput,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetThreadHistoryPageInput,
  OrchestrationGetThreadWindowInput,
  OrchestrationThreadHistoryPage,
  OrchestrationThreadWindowSnapshot,
  OrchestrationThreadWindowStreamItem,
  OrchestrationSearchThreadMessagesInput,
  OrchestrationSearchThreadMessagesResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationGetTaskOutputInput,
  OrchestrationGetTaskOutputResult,
  OrchestrationGetWorkflowScriptInput,
  OrchestrationGetWorkflowScriptResult,
  OrchestrationStopBackgroundTaskInput,
  OrchestrationStopBackgroundTaskResult,
  OrchestrationReplayEventsInput,
  OrchestrationReplayEventsPageInput,
  OrchestrationReplayEventsPageResult,
  OrchestrationReplayEventsResult,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadStreamItem,
} from "./orchestration.ts";
import type { EnvironmentId, ThreadId } from "./baseSchemas.ts";
import type { DiagnosticsSnapshot } from "./diagnostics.ts";
import type { StatisticsSnapshot } from "./statistics.ts";
import type { UsageSummary, UsageSummaryRequest } from "./usage.ts";
import type {
  AuthBearerBootstrapResult,
  AuthSessionState,
  AuthWebSocketTokenResult,
} from "./auth.ts";
import type { AdvertisedEndpoint } from "./remoteAccess.ts";
import { EditorId } from "./editor.ts";
import type { ExecutionEnvironmentDescriptor } from "./environment.ts";
import type { ClientSettings, ServerSettings, ServerSettingsPatch } from "./settings.ts";
import type {
  DeviceAttachInput,
  DeviceBootInput,
  DeviceBootResult,
  DeviceDescribeUiInput,
  DeviceDescribeUiResult,
  DeviceDetachInput,
  DeviceEvent,
  DeviceInstallAppInput,
  DeviceInstallAppResult,
  DeviceKeyEventInput,
  DeviceLaunchAppInput,
  DeviceLaunchAppResult,
  DeviceListInput,
  DeviceListResult,
  DeviceOpenUrlInput,
  DevicePressButtonInput,
  DeviceScreenshotInput,
  DeviceScreenshotResult,
  DeviceScrollToElementInput,
  DeviceScrollToElementResult,
  DeviceShutdownInput,
  DeviceStartRecordingInput,
  DeviceStartRecordingResult,
  DeviceStopRecordingInput,
  DeviceStopRecordingResult,
  DeviceSwipeInput,
  DeviceTapInput,
  DeviceThreadInput,
  DeviceTypeTextInput,
  ThreadDeviceState,
} from "./device.ts";
import type {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
  SourceControlRepositorySearchInput,
  SourceControlRepositorySearchResult,
} from "./sourceControl.ts";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  children?: readonly ContextMenuItem<T>[];
}

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";
export type DesktopUpdateChannel = "latest" | "nightly";
export type DesktopAppStageLabel = "Beta" | "Dev" | "Nightly";

export interface DesktopAppBranding {
  baseName: string;
  stageLabel: DesktopAppStageLabel;
  displayName: string;
}

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  channel: DesktopUpdateChannel;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export interface DesktopEnvironmentBootstrap {
  label: string;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
}

export interface DesktopSshEnvironmentTarget {
  alias: string;
  hostname: string;
  username: string | null;
  port: number | null;
}

export type DesktopSshHostSource = "ssh-config" | "known-hosts";

export interface DesktopDiscoveredSshHost extends DesktopSshEnvironmentTarget {
  source: DesktopSshHostSource;
}

export interface DesktopSshEnvironmentBootstrap {
  target: DesktopSshEnvironmentTarget;
  httpBaseUrl: string;
  wsBaseUrl: string;
  pairingToken: string | null;
  remotePort?: number;
  remoteServerKind?: "external" | "managed";
}

export interface DesktopSshPasswordPromptRequest {
  requestId: string;
  destination: string;
  username: string | null;
  prompt: string;
  expiresAt: string;
}

export interface PersistedSavedEnvironmentRecord {
  environmentId: EnvironmentId;
  label: string;
  wsBaseUrl: string;
  httpBaseUrl: string;
  createdAt: string;
  lastConnectedAt: string | null;
  desktopSsh?: DesktopSshEnvironmentTarget;
}

export type DesktopServerExposureMode = "local-only" | "network-accessible";

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  endpointUrl: string | null;
  advertisedHost: string | null;
  tailscaleServeEnabled: boolean;
  tailscaleServePort: number;
}

export interface PickFolderOptions {
  initialPath?: string | null;
}

/**
 * Payload for a native "agent turn complete" desktop notification. Carries just
 * enough to render the toast and, on click, focus + navigate back to the thread
 * whose turn finished.
 */
export interface DesktopTurnCompleteNotification {
  readonly threadId: ThreadId;
  readonly environmentId?: EnvironmentId | undefined;
  readonly title: string;
  readonly body?: string | undefined;
}

export interface DesktopHubLaunchConfig {
  readonly enabled: boolean;
  readonly origin: string | null;
  readonly nodeName: string | null;
  readonly allowFileSecretStore: boolean;
  /** Whether this host can use the hardened permissioned-file fallback. */
  readonly fileSecretStoreFallbackSupported: boolean;
}

/** Secret-free projection of Desktop main's native Hub identity workflow. */
export interface DesktopHostedIdentityState {
  readonly status: "signed-out" | "ready" | "unavailable";
}

export type DesktopNativeE2eePreparation =
  | { readonly kind: "web-eligible" }
  | { readonly kind: "strict-unavailable" }
  | {
      readonly kind: "native";
      readonly attemptHandle: string;
      readonly credentials: {
        readonly tier: "native";
        readonly accountId: string;
        readonly identityPublicKey: Uint8Array;
        readonly agreementPublicKey: Uint8Array;
        readonly prekeyTranscript: Uint8Array;
        readonly prekeySignature: Uint8Array;
      };
      readonly verifiedPin: {
        readonly identityFingerprint: Uint8Array;
        readonly continuityId: string;
      };
      readonly acceptedPolicyGeneration: number;
    };

export interface DesktopNativeE2eeHandshakeStartInput {
  readonly statement: Uint8Array;
  readonly channel: {
    readonly hubOrigin: string;
    readonly channelId: string;
    readonly relayProtocolMajor: number;
    readonly relayProtocolMinor: number;
    readonly channelOpenCapability: string;
    readonly channelOpenEffectiveRole: string;
  };
  readonly selectedSuite: number;
  readonly offeredSuites: readonly number[];
  readonly intendedCapability: string;
  readonly intendedRole: string;
  readonly now: number;
}

export type DesktopNativeE2eeHandshakeStartResult =
  | {
      readonly kind: "hello";
      readonly handle: string;
      readonly result: {
        readonly kind: "hello";
        readonly record: Uint8Array;
        readonly contextBlock: Uint8Array;
        readonly contextCommitment: Uint8Array;
        readonly prologue: Uint8Array;
        readonly deadlineAt: number;
      };
    }
  | {
      readonly kind: "fatal";
      readonly result: {
        readonly kind: "fatal";
        readonly row: string;
        readonly reason: string;
      };
    };

export type DesktopNativeE2eeHandshakeFinishResult =
  | {
      readonly kind: "established";
      readonly sessionBindingHash: Uint8Array;
      readonly secrets: {
        readonly epochSecretC2N: Uint8Array;
        readonly epochSecretN2C: Uint8Array;
        readonly exporterSecret: Uint8Array;
        readonly serverConfirmationKey: Uint8Array;
      };
      readonly suite: number;
      readonly contextBlock: Uint8Array;
      readonly serverAcceptTbs: Uint8Array;
      readonly confirmationTranscript: Uint8Array;
      readonly webEphemeralPublicKey?: Uint8Array;
    }
  | {
      readonly kind: "fatal";
      readonly row: string;
      readonly reason: string;
    };

export type DesktopHubOriginRejection =
  | "empty"
  | "too_long"
  | "not_a_url"
  | "insecure_scheme"
  | "has_credentials"
  | "has_path"
  | "invalid";

export type DesktopHubOriginValidation =
  | { readonly ok: true; readonly origin: string; readonly normalized: boolean }
  | {
      readonly ok: false;
      readonly reason: DesktopHubOriginRejection;
      readonly suggestion?: string;
    };

export interface DesktopBridge {
  getAppBranding: () => DesktopAppBranding | null;
  getLocalEnvironmentBootstrap: () => DesktopEnvironmentBootstrap | null;
  getClientSettings: () => Promise<ClientSettings | null>;
  setClientSettings: (settings: ClientSettings) => Promise<void>;
  getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
  setSavedEnvironmentRegistry: (
    records: readonly PersistedSavedEnvironmentRecord[],
  ) => Promise<void>;
  getSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<string | null>;
  setSavedEnvironmentSecret: (environmentId: EnvironmentId, secret: string) => Promise<boolean>;
  removeSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<void>;
  discoverSshHosts: () => Promise<readonly DesktopDiscoveredSshHost[]>;
  ensureSshEnvironment: (
    target: DesktopSshEnvironmentTarget,
    options?: { issuePairingToken?: boolean },
  ) => Promise<DesktopSshEnvironmentBootstrap>;
  disconnectSshEnvironment: (target: DesktopSshEnvironmentTarget) => Promise<void>;
  fetchSshEnvironmentDescriptor: (httpBaseUrl: string) => Promise<ExecutionEnvironmentDescriptor>;
  bootstrapSshBearerSession: (
    httpBaseUrl: string,
    credential: string,
  ) => Promise<AuthBearerBootstrapResult>;
  fetchSshSessionState: (httpBaseUrl: string, bearerToken: string) => Promise<AuthSessionState>;
  issueSshWebSocketToken: (
    httpBaseUrl: string,
    bearerToken: string,
  ) => Promise<AuthWebSocketTokenResult>;
  onSshPasswordPrompt: (listener: (request: DesktopSshPasswordPromptRequest) => void) => () => void;
  resolveSshPasswordPrompt: (requestId: string, password: string | null) => Promise<void>;
  getServerExposureState: () => Promise<DesktopServerExposureState>;
  setServerExposureMode: (mode: DesktopServerExposureMode) => Promise<DesktopServerExposureState>;
  setTailscaleServeEnabled: (input: {
    readonly enabled: boolean;
    readonly port?: number;
  }) => Promise<DesktopServerExposureState>;
  getHubLaunchConfig: () => Promise<DesktopHubLaunchConfig>;
  /** Native account setup is available only in Desktop builds that support hardware-backed keys. */
  getHostedIdentityState?: () => Promise<DesktopHostedIdentityState>;
  connectHostedIdentity?: () => Promise<DesktopHostedIdentityState>;
  disconnectHostedIdentity?: () => Promise<DesktopHostedIdentityState>;
  prepareNativeE2eeAttempt?: (input: {
    readonly accountId: string;
    readonly nodeId: string;
  }) => Promise<DesktopNativeE2eePreparation>;
  startNativeE2eeHandshake?: (
    attemptHandle: string,
    input: DesktopNativeE2eeHandshakeStartInput,
  ) => Promise<DesktopNativeE2eeHandshakeStartResult>;
  finishNativeE2eeHandshake?: (
    handle: string,
    payload: Uint8Array,
  ) => Promise<DesktopNativeE2eeHandshakeFinishResult>;
  destroyNativeE2eeHandshake?: (handle: string) => Promise<void>;
  /**
   * Persist hub launch configuration and relaunch to apply it.
   *
   * The connector is built during server startup, so a change cannot take effect
   * in the running process — the same reason network access and Tailscale Serve
   * relaunch. Callers must confirm with the operator first.
   */
  setHubLaunchConfig: (input: {
    readonly enabled?: boolean;
    readonly origin?: string | null;
    readonly nodeName?: string | null;
    readonly allowFileSecretStore?: boolean;
  }) => Promise<void>;
  /** Validate a typed Hub address without persisting it. */
  validateHubOrigin: (raw: string) => Promise<DesktopHubOriginValidation>;
  getAdvertisedEndpoints: () => Promise<readonly AdvertisedEndpoint[]>;
  getPathForFile?: (file: File) => string;
  pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  setUpdateChannel: (channel: DesktopUpdateChannel) => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
  /** Show a native notification when a turn completes and the window is unfocused. */
  notifyTurnComplete: (notification: DesktopTurnCompleteNotification) => Promise<void>;
  /** Subscribe to notification clicks so the renderer can navigate to the thread. */
  onTurnCompleteNotificationActivated: (
    listener: (notification: DesktopTurnCompleteNotification) => void,
  ) => () => void;
}

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * These capabilities describe the desktop/browser host that the user is
 * currently running: dialogs, editor/external-link opening, context menus, and
 * app-level settings/config access. They must not be used as a proxy for
 * "whatever environment the user is targeting", because in a multi-environment
 * world the local shell and a selected backend environment are distinct
 * concepts.
 */
export interface LocalApi {
  dialogs: {
    pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    getPathForFile?: (file: File) => Promise<string | null>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
    getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
    setSavedEnvironmentRegistry: (
      records: readonly PersistedSavedEnvironmentRecord[],
    ) => Promise<void>;
    getSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<string | null>;
    setSavedEnvironmentSecret: (environmentId: EnvironmentId, secret: string) => Promise<boolean>;
    removeSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<void>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    getAdvertisedEndpoints: () => Promise<readonly AdvertisedEndpoint[]>;
    getDiagnosticsMetrics: () => Promise<ServerLocalDiagnosticsMetrics>;
    getStatistics: () => Promise<StatisticsSnapshot>;
    getUsageSummary: (input: UsageSummaryRequest) => Promise<UsageSummary>;
    /**
     * Refresh provider snapshots. When `input.instanceId` is supplied only that
     * configured instance is probed; otherwise every configured instance is
     * refreshed (legacy untargeted refresh).
     */
    refreshProviders: (input?: {
      readonly instanceId?: ProviderInstanceId;
    }) => Promise<ServerProviderUpdatedPayload>;
    updateProvider: (input: ServerProviderUpdateInput) => Promise<ServerProviderUpdatedPayload>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
    getDiagnosticsSnapshot: () => Promise<DiagnosticsSnapshot>;
    discoverSourceControl: () => Promise<SourceControlDiscoveryResult>;
    listOpinionatedPlugins: () => Promise<OpinionatedPluginListResult>;
    checkOpinionatedPlugins: (
      input?: OpinionatedPluginCheckInput,
    ) => Promise<OpinionatedPluginStatusResult>;
    installOpinionatedPlugin: (
      input: OpinionatedPluginInstallInput,
    ) => Promise<OpinionatedPluginInstallResult>;
  };
  keybindings: {
    replaceCustom: (
      input: KeybindingsReplaceCustomInput,
    ) => Promise<KeybindingsReplaceCustomResult>;
  };
  mcp?: {
    listWorkspaces: () => Promise<McpListWorkspacesResult>;
    listServers: (input: McpListServersInput) => Promise<McpListServersResult>;
    upsertServer: (input: McpServerUpsertInput) => Promise<McpListServersResult>;
    setServerEnabled: (input: McpServerEnabledInput) => Promise<McpListServersResult>;
    removeServer: (input: McpServerRemoveInput) => Promise<McpListServersResult>;
    reloadServers: (input: McpServersReloadInput) => Promise<McpListServersResult>;
    startOauthLogin: (input: McpOauthLoginInput) => Promise<McpOauthLoginResult>;
  };
}

/**
 * APIs bound to a specific backend environment connection.
 *
 * These operations must always be routed with explicit environment context.
 * They represent remote stateful capabilities such as orchestration, terminal,
 * project, VCS, and provider operations. In multi-environment mode, each environment gets
 * its own instance of this surface, and callers should resolve it by
 * `environmentId` rather than reaching through the local desktop bridge.
 */
export interface EnvironmentApi {
  device?: {
    list: (input?: DeviceListInput) => Promise<DeviceListResult>;
    getThreadState: (input: DeviceThreadInput) => Promise<ThreadDeviceState>;
    screenshot: (input: DeviceScreenshotInput) => Promise<DeviceScreenshotResult>;
    describeUi: (input: DeviceDescribeUiInput) => Promise<DeviceDescribeUiResult>;
    boot: (input: DeviceBootInput) => Promise<DeviceBootResult>;
    shutdown: (input: DeviceShutdownInput) => Promise<void>;
    attach: (input: DeviceAttachInput) => Promise<ThreadDeviceState>;
    detach: (input: DeviceDetachInput) => Promise<ThreadDeviceState>;
    tap: (input: DeviceTapInput) => Promise<void>;
    swipe: (input: DeviceSwipeInput) => Promise<void>;
    typeText: (input: DeviceTypeTextInput) => Promise<void>;
    keyEvent: (input: DeviceKeyEventInput) => Promise<void>;
    pressButton: (input: DevicePressButtonInput) => Promise<void>;
    scrollToElement: (input: DeviceScrollToElementInput) => Promise<DeviceScrollToElementResult>;
    installApp: (input: DeviceInstallAppInput) => Promise<DeviceInstallAppResult>;
    launchApp: (input: DeviceLaunchAppInput) => Promise<DeviceLaunchAppResult>;
    openUrl: (input: DeviceOpenUrlInput) => Promise<void>;
    startRecording: (input: DeviceStartRecordingInput) => Promise<DeviceStartRecordingResult>;
    stopRecording: (input: DeviceStopRecordingInput) => Promise<DeviceStopRecordingResult>;
    onEvent: (callback: (event: DeviceEvent) => void) => () => void;
  };
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>;
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>;
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>;
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>;
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>;
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    listEntries: (input: ProjectListEntriesInput) => Promise<ProjectListEntriesResult>;
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>;
    readFileBinary: (input: ProjectReadFileBinaryInput) => Promise<ProjectReadFileBinaryResult>;
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
    stageFileReference: (
      input: ProjectStageFileReferenceInput,
    ) => Promise<ProjectStageFileReferenceResult>;
    initializeGit?: (input: ProjectsInitializeGitInput) => Promise<EmptyRpcResult>;
  };
  filesystem: {
    browse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  };
  sourceControl: {
    lookupRepository: (
      input: SourceControlRepositoryLookupInput,
    ) => Promise<SourceControlRepositoryInfo>;
    searchRepositories: (
      input: SourceControlRepositorySearchInput,
    ) => Promise<SourceControlRepositorySearchResult>;
    cloneRepository: (
      input: SourceControlCloneRepositoryInput,
    ) => Promise<SourceControlCloneRepositoryResult>;
    publishRepository: (
      input: SourceControlPublishRepositoryInput,
    ) => Promise<SourceControlPublishRepositoryResult>;
  };
  vcs: {
    listRefs: (input: VcsListRefsInput) => Promise<VcsListRefsResult>;
    createWorktree: (input: VcsCreateWorktreeInput) => Promise<VcsCreateWorktreeResult>;
    removeWorktree: (input: VcsRemoveWorktreeInput) => Promise<void>;
    createRef: (input: VcsCreateRefInput) => Promise<VcsCreateRefResult>;
    switchRef: (input: VcsSwitchRefInput) => Promise<VcsSwitchRefResult>;
    init: (input: VcsInitInput) => Promise<void>;
    pull: (input: VcsPullInput) => Promise<VcsPullResult>;
    refreshStatus: (input: VcsStatusInput) => Promise<VcsStatusResult>;
    onStatus: (
      input: VcsStatusInput,
      callback: (status: VcsStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  git: {
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    createWorktreeForProject?: (
      input: GitCreateWorktreeForProjectInput,
    ) => Promise<GitCreateWorktreeForProjectOutput>;
    findWorktreeForOrigin?: (
      input: GitFindWorktreeForOriginInput,
    ) => Promise<GitFindWorktreeForOriginOutput>;
    archiveWorktree?: (input: GitArchiveWorktreeInput) => Promise<EmptyRpcResult>;
    restoreWorktree?: (input: GitRestoreWorktreeInput) => Promise<EmptyRpcResult>;
    deleteWorktree?: (input: GitDeleteWorktreeInput) => Promise<EmptyRpcResult>;
  };
  worktrees?: {
    setManualPosition: (input: WorktreesSetManualPositionInput) => Promise<EmptyRpcResult>;
  };
  threads?: {
    setManualBucket: (input: ThreadsSetManualBucketInput) => Promise<EmptyRpcResult>;
    setManualPosition: (input: ThreadsSetManualPositionInput) => Promise<EmptyRpcResult>;
  };
  orchestration: {
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    /** Optional so clients can feature-detect against older environments. */
    getWorkflowScript?: (
      input: OrchestrationGetWorkflowScriptInput,
    ) => Promise<OrchestrationGetWorkflowScriptResult>;
    /** Optional so clients can feature-detect against older environments. */
    getTaskOutput?: (
      input: OrchestrationGetTaskOutputInput,
    ) => Promise<OrchestrationGetTaskOutputResult>;
    /** Optional so clients can feature-detect against older environments. */
    stopBackgroundTask?: (
      input: OrchestrationStopBackgroundTaskInput,
    ) => Promise<OrchestrationStopBackgroundTaskResult>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    searchThreadMessages: (
      input: OrchestrationSearchThreadMessagesInput,
    ) => Promise<OrchestrationSearchThreadMessagesResult>;
    /** Optional so clients can feature-detect against older environments. */
    getThreadWindow?: (
      input: OrchestrationGetThreadWindowInput,
    ) => Promise<OrchestrationThreadWindowSnapshot>;
    /** Optional so clients can feature-detect against older environments. */
    getThreadHistoryPage?: (
      input: OrchestrationGetThreadHistoryPageInput,
    ) => Promise<OrchestrationThreadHistoryPage>;
    replayEvents?: (
      input: OrchestrationReplayEventsInput,
    ) => Promise<OrchestrationReplayEventsResult>;
    replayEventsPage?: (
      input: OrchestrationReplayEventsPageInput,
    ) => Promise<OrchestrationReplayEventsPageResult>;
    subscribeShell: (
      callback: (event: OrchestrationShellStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    subscribeThread: (
      input: OrchestrationSubscribeThreadInput,
      callback: (event: OrchestrationThreadStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    /** Optional so clients can feature-detect against older environments. */
    subscribeThreadWindow?: (
      input: OrchestrationGetThreadWindowInput,
      callback: (event: OrchestrationThreadWindowStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
        onError?: () => void;
      },
    ) => () => void;
  };
  contextHandoff: {
    getInspectionSummary: (
      input: ContextHandoffInspectionSummaryInput,
    ) => Promise<ContextHandoffInspectionSummary>;
    listInspectionEntries: (
      input: ContextHandoffInspectionEntriesInput,
    ) => Promise<ContextHandoffInspectionEntriesPage>;
    readRawPayloadChunk: (
      input: ContextHandoffRawPayloadChunkInput,
    ) => Promise<ContextHandoffRawPayloadChunk>;
    readExportChunk: (input: ContextHandoffExportChunkInput) => Promise<ContextHandoffExportChunk>;
  };
}

import { Effect, Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;

const makeBrowserEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyStringSchema.pipe(Schema.brand(brand));

export const BrowserHostId = makeBrowserEntityId("BrowserHostId");
export type BrowserHostId = typeof BrowserHostId.Type;

export const BrowserHostRunId = makeBrowserEntityId("BrowserHostRunId");
export type BrowserHostRunId = typeof BrowserHostRunId.Type;

export const BrowserProfileId = makeBrowserEntityId("BrowserProfileId");
export type BrowserProfileId = typeof BrowserProfileId.Type;

export const BrowserSessionId = makeBrowserEntityId("BrowserSessionId");
export type BrowserSessionId = typeof BrowserSessionId.Type;

export const BrowserTabId = makeBrowserEntityId("BrowserTabId");
export type BrowserTabId = typeof BrowserTabId.Type;

export const BrowserCommandId = makeBrowserEntityId("BrowserCommandId");
export type BrowserCommandId = typeof BrowserCommandId.Type;

export const BrowserPermissionRequestId = makeBrowserEntityId("BrowserPermissionRequestId");
export type BrowserPermissionRequestId = typeof BrowserPermissionRequestId.Type;

export const BrowserArtifactId = makeBrowserEntityId("BrowserArtifactId");
export type BrowserArtifactId = typeof BrowserArtifactId.Type;

export const BrowserProfileMode = Schema.Literals([
  "temporary",
  "thread",
  "worktree",
  "project",
  "named",
]);
export type BrowserProfileMode = typeof BrowserProfileMode.Type;

export const BrowserProfileScope = Schema.Struct({
  mode: BrowserProfileMode,
  projectId: Schema.optional(ProjectId),
  threadId: Schema.optional(ThreadId),
  worktreePath: Schema.optional(TrimmedNonEmptyStringSchema),
  name: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type BrowserProfileScope = typeof BrowserProfileScope.Type;

export const BrowserProfileStorageStats = Schema.Struct({
  bytes: NonNegativeInt,
  cookies: Schema.optional(NonNegativeInt),
  origins: Schema.optional(NonNegativeInt),
  lastCalculatedAt: Schema.optional(IsoDateTime),
});
export type BrowserProfileStorageStats = typeof BrowserProfileStorageStats.Type;

export const BrowserProfile = Schema.Struct({
  profileId: BrowserProfileId,
  displayName: TrimmedNonEmptyStringSchema,
  mode: BrowserProfileMode,
  scope: BrowserProfileScope,
  persistent: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  storageStats: Schema.optional(BrowserProfileStorageStats),
  lockedBy: Schema.optional(
    Schema.Struct({
      hostId: BrowserHostId,
      runId: BrowserHostRunId,
      leasedUntil: IsoDateTime,
      heartbeatAt: IsoDateTime,
    }),
  ),
});
export type BrowserProfile = typeof BrowserProfile.Type;

export const BrowserLoadState = Schema.Literals(["idle", "loading", "loaded", "failed"]);
export type BrowserLoadState = typeof BrowserLoadState.Type;

export const BrowserNavigationState = Schema.Struct({
  url: Schema.String,
  origin: Schema.NullOr(Schema.String),
  title: Schema.optional(Schema.String),
  loadState: BrowserLoadState,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  lastNavigationError: Schema.optional(Schema.String),
});
export type BrowserNavigationState = typeof BrowserNavigationState.Type;

export const BrowserTabSnapshot = Schema.Struct({
  tabId: BrowserTabId,
  sessionId: BrowserSessionId,
  profileId: BrowserProfileId,
  selected: Schema.Boolean,
  crashed: Schema.Boolean,
  navigation: BrowserNavigationState,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BrowserTabSnapshot = typeof BrowserTabSnapshot.Type;

export const BrowserSessionSnapshot = Schema.Struct({
  sessionId: BrowserSessionId,
  profileId: BrowserProfileId,
  threadId: ThreadId,
  projectId: Schema.optional(ProjectId),
  hostId: Schema.optional(BrowserHostId),
  selectedTabId: Schema.NullOr(BrowserTabId),
  tabs: Schema.Array(BrowserTabSnapshot),
  status: Schema.Literals(["opening", "ready", "degraded", "closed", "error"]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BrowserSessionSnapshot = typeof BrowserSessionSnapshot.Type;

export const BrowserHostCapabilities = Schema.Struct({
  surface: Schema.Boolean,
  persistentProfiles: Schema.Boolean,
  temporaryProfiles: Schema.Boolean,
  screenshots: Schema.Boolean,
  domSnapshot: Schema.Boolean,
  input: Schema.Boolean,
  downloads: Schema.Boolean,
  devtools: Schema.Boolean,
});
export type BrowserHostCapabilities = typeof BrowserHostCapabilities.Type;

export const BrowserHostSnapshot = Schema.Struct({
  hostId: BrowserHostId,
  runId: BrowserHostRunId,
  connected: Schema.Boolean,
  capabilities: BrowserHostCapabilities,
  registeredAt: IsoDateTime,
  heartbeatAt: IsoDateTime,
});
export type BrowserHostSnapshot = typeof BrowserHostSnapshot.Type;

export const BrowserStatusSnapshot = Schema.Struct({
  supported: Schema.Boolean,
  reason: Schema.optional(
    Schema.Literals(["desktop_host_missing", "remote_unsupported", "browser_disabled"]),
  ),
  host: Schema.NullOr(BrowserHostSnapshot),
  sessions: Schema.Array(BrowserSessionSnapshot),
});
export type BrowserStatusSnapshot = typeof BrowserStatusSnapshot.Type;

export const BrowserOriginPolicyDecision = Schema.Literals([
  "ask",
  "allow_session",
  "allow_profile",
  "allow_project",
  "deny",
]);
export type BrowserOriginPolicyDecision = typeof BrowserOriginPolicyDecision.Type;

export const BrowserOriginPolicy = Schema.Struct({
  origin: TrimmedNonEmptyStringSchema,
  decision: BrowserOriginPolicyDecision,
  scopeId: Schema.optional(TrimmedNonEmptyStringSchema),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BrowserOriginPolicy = typeof BrowserOriginPolicy.Type;

export const BrowserPermissionKind = Schema.Literals([
  "camera",
  "microphone",
  "location",
  "notifications",
  "midi",
  "clipboard",
  "fullscreen",
  "download",
  "popup",
  "file-system",
  "media-capture",
]);
export type BrowserPermissionKind = typeof BrowserPermissionKind.Type;

export const BrowserPermissionPolicyDecision = Schema.Literals(["ask", "allow_once", "deny"]);
export type BrowserPermissionPolicyDecision = typeof BrowserPermissionPolicyDecision.Type;

export const BrowserPermissionPolicy = Schema.Struct({
  permission: BrowserPermissionKind,
  origin: Schema.optional(TrimmedNonEmptyStringSchema),
  decision: BrowserPermissionPolicyDecision,
});
export type BrowserPermissionPolicy = typeof BrowserPermissionPolicy.Type;

export const BrowserToolAccessDecision = Schema.Struct({
  decision: Schema.Literals(["allow", "ask", "deny"]),
  reason: Schema.optional(TrimmedNonEmptyStringSchema),
  policy: Schema.optional(BrowserOriginPolicy),
});
export type BrowserToolAccessDecision = typeof BrowserToolAccessDecision.Type;

export const BrowserOpenSessionInput = Schema.Struct({
  threadId: ThreadId,
  projectId: Schema.optional(ProjectId),
  profileMode: Schema.optional(BrowserProfileMode),
  profileName: Schema.optional(TrimmedNonEmptyStringSchema),
  initialUrl: Schema.optional(Schema.String),
});
export type BrowserOpenSessionInput = typeof BrowserOpenSessionInput.Type;

export const BrowserSessionInput = Schema.Struct({
  sessionId: BrowserSessionId,
});
export type BrowserSessionInput = typeof BrowserSessionInput.Type;

export const BrowserTabInput = Schema.Struct({
  sessionId: BrowserSessionId,
  tabId: BrowserTabId,
});
export type BrowserTabInput = typeof BrowserTabInput.Type;

export const BrowserNavigateInput = Schema.Struct({
  sessionId: BrowserSessionId,
  tabId: Schema.optional(BrowserTabId),
  url: Schema.String.check(Schema.isMaxLength(8_192)),
});
export type BrowserNavigateInput = typeof BrowserNavigateInput.Type;

export const BrowserControlInput = Schema.Struct({
  sessionId: BrowserSessionId,
  tabId: Schema.optional(BrowserTabId),
});
export type BrowserControlInput = typeof BrowserControlInput.Type;

export const BrowserInputAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("click"),
    x: Schema.Number,
    y: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("type"),
    text: Schema.String.check(Schema.isMaxLength(32_768)),
  }),
  Schema.Struct({
    type: Schema.Literal("key"),
    key: TrimmedNonEmptyStringSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("scroll"),
    deltaX: Schema.Number,
    deltaY: Schema.Number,
  }),
]);
export type BrowserInputAction = typeof BrowserInputAction.Type;

export const BrowserInputCommandInput = Schema.Struct({
  sessionId: BrowserSessionId,
  tabId: Schema.optional(BrowserTabId),
  action: BrowserInputAction,
});
export type BrowserInputCommandInput = typeof BrowserInputCommandInput.Type;

export const BrowserStorageScope = Schema.Literals(["current_origin", "profile"]);
export type BrowserStorageScope = typeof BrowserStorageScope.Type;

export const BrowserStorageDataType = Schema.Literals([
  "cookies",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "cacheStorage",
  "serviceWorkers",
  "httpCache",
]);
export type BrowserStorageDataType = typeof BrowserStorageDataType.Type;

export const BrowserCookieMetadata = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(4_096)),
  domain: Schema.String.check(Schema.isMaxLength(4_096)),
  path: Schema.String.check(Schema.isMaxLength(4_096)),
  secure: Schema.Boolean,
  httpOnly: Schema.Boolean,
  session: Schema.Boolean,
  sameSite: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
  expirationDate: Schema.optional(Schema.Number),
  sizeBytes: NonNegativeInt,
});
export type BrowserCookieMetadata = typeof BrowserCookieMetadata.Type;

export const BrowserStorageEntryMetadata = Schema.Struct({
  key: Schema.String.check(Schema.isMaxLength(4_096)),
  valueBytes: NonNegativeInt,
});
export type BrowserStorageEntryMetadata = typeof BrowserStorageEntryMetadata.Type;

export const BrowserStorageInspectionResult = Schema.Struct({
  session: BrowserSessionSnapshot,
  tabId: BrowserTabId,
  profileId: BrowserProfileId,
  url: Schema.String,
  origin: Schema.NullOr(Schema.String),
  cookies: Schema.Array(BrowserCookieMetadata),
  localStorage: Schema.Array(BrowserStorageEntryMetadata),
  sessionStorage: Schema.Array(BrowserStorageEntryMetadata),
  cookieCounts: Schema.Struct({
    currentOrigin: NonNegativeInt,
    profile: NonNegativeInt,
  }),
  inspectedAt: IsoDateTime,
});
export type BrowserStorageInspectionResult = typeof BrowserStorageInspectionResult.Type;

export const BrowserStorageInspectInput = Schema.Struct({
  sessionId: BrowserSessionId,
  tabId: Schema.optional(BrowserTabId),
});
export type BrowserStorageInspectInput = typeof BrowserStorageInspectInput.Type;

export const BrowserStorageClearInput = Schema.Struct({
  sessionId: BrowserSessionId,
  tabId: Schema.optional(BrowserTabId),
  scope: BrowserStorageScope,
  dataTypes: Schema.Array(BrowserStorageDataType),
});
export type BrowserStorageClearInput = typeof BrowserStorageClearInput.Type;

export const BrowserStorageClearResult = Schema.Struct({
  session: BrowserSessionSnapshot,
  scope: BrowserStorageScope,
  origin: Schema.NullOr(Schema.String),
  clearedDataTypes: Schema.Array(BrowserStorageDataType),
  clearedAt: IsoDateTime,
});
export type BrowserStorageClearResult = typeof BrowserStorageClearResult.Type;

export const BrowserCookieDeleteInput = Schema.Struct({
  sessionId: BrowserSessionId,
  tabId: Schema.optional(BrowserTabId),
  url: Schema.optional(Schema.String.check(Schema.isMaxLength(8_192))),
  name: TrimmedNonEmptyStringSchema,
  domain: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
  path: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
  secure: Schema.optional(Schema.Boolean),
});
export type BrowserCookieDeleteInput = typeof BrowserCookieDeleteInput.Type;

export const BrowserCookieDeleteResult = Schema.Struct({
  session: BrowserSessionSnapshot,
  deleted: Schema.Boolean,
  cookie: Schema.Struct({
    name: TrimmedNonEmptyStringSchema,
    domain: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
    path: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
    secure: Schema.optional(Schema.Boolean),
  }),
  deletedAt: IsoDateTime,
});
export type BrowserCookieDeleteResult = typeof BrowserCookieDeleteResult.Type;

export const BrowserListProfilesResult = Schema.Struct({
  profiles: Schema.Array(BrowserProfile),
});
export type BrowserListProfilesResult = typeof BrowserListProfilesResult.Type;

export const BrowserCommandKind = Schema.Literals([
  "open_session",
  "close_session",
  "navigate",
  "back",
  "forward",
  "reload",
  "stop",
  "input",
  "snapshot_dom",
  "screenshot",
  "read_console",
  "read_network",
  "inspect_storage",
  "clear_storage",
  "delete_cookie",
]);
export type BrowserCommandKind = typeof BrowserCommandKind.Type;

export const BrowserHostCommand = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("open_session"),
    session: BrowserSessionSnapshot,
    profile: BrowserProfile,
    initialUrl: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("close_session"),
    sessionId: BrowserSessionId,
  }),
  Schema.Struct({
    kind: Schema.Literal("navigate"),
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    url: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literals(["back", "forward", "reload", "stop"]),
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
  }),
  Schema.Struct({
    kind: Schema.Literal("input"),
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    action: BrowserInputAction,
  }),
  Schema.Struct({
    kind: Schema.Literals(["snapshot_dom", "screenshot", "read_console", "read_network"]),
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
  }),
  Schema.Struct({
    kind: Schema.Literal("inspect_storage"),
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
  }),
  Schema.Struct({
    kind: Schema.Literal("clear_storage"),
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    scope: BrowserStorageScope,
    dataTypes: Schema.Array(BrowserStorageDataType),
  }),
  Schema.Struct({
    kind: Schema.Literal("delete_cookie"),
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    url: Schema.optional(Schema.String.check(Schema.isMaxLength(8_192))),
    name: TrimmedNonEmptyStringSchema,
    domain: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
    path: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
    secure: Schema.optional(Schema.Boolean),
  }),
]);
export type BrowserHostCommand = typeof BrowserHostCommand.Type;

export const BrowserHostCommandEnvelope = Schema.Struct({
  commandId: BrowserCommandId,
  hostId: BrowserHostId,
  runId: BrowserHostRunId,
  command: BrowserHostCommand,
  issuedAt: IsoDateTime,
  timeoutMs: PositiveInt,
});
export type BrowserHostCommandEnvelope = typeof BrowserHostCommandEnvelope.Type;

export const BrowserArtifactKind = Schema.Literals(["screenshot", "dom_snapshot", "download"]);
export type BrowserArtifactKind = typeof BrowserArtifactKind.Type;

export const BrowserArtifactRef = Schema.Struct({
  artifactId: BrowserArtifactId,
  kind: BrowserArtifactKind,
  mimeType: TrimmedNonEmptyStringSchema,
  byteSize: NonNegativeInt,
  url: Schema.optional(Schema.String),
  origin: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type BrowserArtifactRef = typeof BrowserArtifactRef.Type;

export const BrowserCommandResultPayload = Schema.Struct({
  session: Schema.optional(BrowserSessionSnapshot),
  tab: Schema.optional(BrowserTabSnapshot),
  text: Schema.optional(Schema.String),
  artifact: Schema.optional(BrowserArtifactRef),
  storageInspection: Schema.optional(BrowserStorageInspectionResult),
  storageClear: Schema.optional(BrowserStorageClearResult),
  cookieDelete: Schema.optional(BrowserCookieDeleteResult),
  data: Schema.optional(Schema.Unknown),
});
export type BrowserCommandResultPayload = typeof BrowserCommandResultPayload.Type;

export const BrowserCommandResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    commandId: BrowserCommandId,
    result: BrowserCommandResultPayload,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    commandId: BrowserCommandId,
    error: Schema.Struct({
      code: TrimmedNonEmptyStringSchema,
      message: TrimmedNonEmptyStringSchema,
      retryable: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
    }),
  }),
]);
export type BrowserCommandResult = typeof BrowserCommandResult.Type;

export const BrowserEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("host.connected"),
    host: BrowserHostSnapshot,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("host.disconnected"),
    hostId: BrowserHostId,
    runId: BrowserHostRunId,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("session.updated"),
    session: BrowserSessionSnapshot,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("session.closed"),
    sessionId: BrowserSessionId,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("tab.updated"),
    tab: BrowserTabSnapshot,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("tab.crashed"),
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    reason: Schema.optional(Schema.String),
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("permission.requested"),
    requestId: BrowserPermissionRequestId,
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    origin: Schema.String,
    permission: BrowserPermissionKind,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("download.updated"),
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    artifact: BrowserArtifactRef,
    state: Schema.Literals(["started", "progress", "completed", "failed", "cancelled"]),
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("command.progress"),
    commandId: BrowserCommandId,
    message: TrimmedNonEmptyStringSchema,
    createdAt: IsoDateTime,
  }),
]);
export type BrowserEvent = typeof BrowserEvent.Type;

export class BrowserServiceError extends Schema.TaggedErrorClass<BrowserServiceError>()(
  "BrowserServiceError",
  {
    code: Schema.Literals([
      "host_unavailable",
      "profile_locked",
      "session_not_found",
      "tab_not_found",
      "navigation_blocked",
      "origin_denied",
      "permission_denied",
      "command_timeout",
      "unsupported_capability",
      "invalid_url",
      "queue_full",
      "host_disconnected",
    ]),
    message: TrimmedNonEmptyStringSchema,
    retryable: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const BrowserHostRegisterInput = Schema.Struct({
  hostId: BrowserHostId,
  runId: BrowserHostRunId,
  capabilities: BrowserHostCapabilities,
});
export type BrowserHostRegisterInput = typeof BrowserHostRegisterInput.Type;

export const BrowserHostRegisterResult = Schema.Struct({
  accepted: Schema.Boolean,
  host: BrowserHostSnapshot,
});
export type BrowserHostRegisterResult = typeof BrowserHostRegisterResult.Type;

export const BrowserHostHeartbeatInput = Schema.Struct({
  hostId: BrowserHostId,
  runId: BrowserHostRunId,
  sessions: Schema.optional(Schema.Array(BrowserSessionSnapshot)),
});
export type BrowserHostHeartbeatInput = typeof BrowserHostHeartbeatInput.Type;

export const BrowserHostSubscribeCommandsInput = Schema.Struct({
  hostId: BrowserHostId,
  runId: BrowserHostRunId,
});
export type BrowserHostSubscribeCommandsInput = typeof BrowserHostSubscribeCommandsInput.Type;

export const BrowserHostCommandResultInput = Schema.Struct({
  hostId: BrowserHostId,
  runId: BrowserHostRunId,
  result: BrowserCommandResult,
});
export type BrowserHostCommandResultInput = typeof BrowserHostCommandResultInput.Type;

export const BrowserHostEventInput = Schema.Struct({
  hostId: BrowserHostId,
  runId: BrowserHostRunId,
  event: BrowserEvent,
});
export type BrowserHostEventInput = typeof BrowserHostEventInput.Type;

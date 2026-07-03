import { sanitizeBrowserProfileKey } from "@ryco/shared/browser";
import { Context, Effect, Layer, Option, PubSub, Ref, Stream } from "effect";

import {
  BrowserProfileId,
  BrowserServiceError,
  BrowserSessionId,
  BrowserTabId,
  type BrowserControlInput,
  type BrowserCookieDeleteInput,
  type BrowserCookieDeleteResult,
  type BrowserConsoleResult,
  type BrowserDomSnapshotResult,
  type BrowserEvent,
  type BrowserInputCommandInput,
  type BrowserListProfilesResult,
  type BrowserNavigateInput,
  type BrowserNetworkResult,
  type BrowserOpenSessionInput,
  type BrowserProfile,
  type BrowserProfileMode,
  type BrowserScreenshotResult,
  type BrowserSessionInput,
  type BrowserSessionSnapshot,
  type BrowserStorageClearInput,
  type BrowserStorageClearResult,
  type BrowserStorageInspectInput,
  type BrowserStorageInspectionResult,
  type BrowserStatusSnapshot,
  type BrowserTabSnapshot,
  type BrowserWaitForInput,
  type BrowserWaitForResult,
  type ThreadId,
} from "@ryco/contracts";

import { ServerConfig } from "../config.ts";
import { BrowserArtifactStore } from "./BrowserArtifactStore.ts";
import { BrowserHostRegistry } from "./BrowserHostRegistry.ts";
import {
  base64ToUint8Array,
  decodeBrowserHostConsoleData,
  decodeBrowserHostDomSnapshotData,
  decodeBrowserHostNetworkData,
  decodeBrowserHostScreenshotData,
} from "./BrowserObservationHelpers.ts";
import { BrowserPolicy } from "./BrowserPolicy.ts";

interface BrowserServiceState {
  readonly profiles: ReadonlyMap<string, BrowserProfile>;
  readonly sessions: ReadonlyMap<string, BrowserSessionSnapshot>;
  readonly sessionOwners: ReadonlyMap<string, "agent" | "ui">;
}

export interface BrowserServiceShape {
  readonly getStatus: Effect.Effect<BrowserStatusSnapshot, BrowserServiceError>;
  readonly listProfiles: Effect.Effect<BrowserListProfilesResult, BrowserServiceError>;
  readonly openSession: (
    input: BrowserOpenSessionInput,
  ) => Effect.Effect<BrowserSessionSnapshot, BrowserServiceError>;
  readonly closeSession: (
    input: BrowserSessionInput,
  ) => Effect.Effect<BrowserSessionSnapshot, BrowserServiceError>;
  readonly getSnapshot: (
    input: BrowserSessionInput,
  ) => Effect.Effect<BrowserSessionSnapshot, BrowserServiceError>;
  readonly navigate: (
    input: BrowserNavigateInput,
  ) => Effect.Effect<BrowserSessionSnapshot, BrowserServiceError>;
  readonly back: (
    input: BrowserControlInput,
  ) => Effect.Effect<BrowserSessionSnapshot, BrowserServiceError>;
  readonly forward: (
    input: BrowserControlInput,
  ) => Effect.Effect<BrowserSessionSnapshot, BrowserServiceError>;
  readonly reload: (
    input: BrowserControlInput,
  ) => Effect.Effect<BrowserSessionSnapshot, BrowserServiceError>;
  readonly stop: (
    input: BrowserControlInput,
  ) => Effect.Effect<BrowserSessionSnapshot, BrowserServiceError>;
  readonly input: (
    input: BrowserInputCommandInput,
  ) => Effect.Effect<BrowserSessionSnapshot, BrowserServiceError>;
  readonly inspectStorage: (
    input: BrowserStorageInspectInput,
  ) => Effect.Effect<BrowserStorageInspectionResult, BrowserServiceError>;
  readonly clearStorage: (
    input: BrowserStorageClearInput,
  ) => Effect.Effect<BrowserStorageClearResult, BrowserServiceError>;
  readonly deleteCookie: (
    input: BrowserCookieDeleteInput,
  ) => Effect.Effect<BrowserCookieDeleteResult, BrowserServiceError>;
  readonly snapshotDom: (
    input: BrowserControlInput,
  ) => Effect.Effect<BrowserDomSnapshotResult, BrowserServiceError>;
  readonly screenshot: (
    input: BrowserControlInput,
  ) => Effect.Effect<BrowserScreenshotResult, BrowserServiceError>;
  readonly readConsole: (
    input: BrowserControlInput,
  ) => Effect.Effect<BrowserConsoleResult, BrowserServiceError>;
  readonly readNetwork: (
    input: BrowserControlInput,
  ) => Effect.Effect<BrowserNetworkResult, BrowserServiceError>;
  readonly waitFor: (
    input: BrowserWaitForInput,
  ) => Effect.Effect<BrowserWaitForResult, BrowserServiceError>;
  readonly closeAgentSessionsForThread: (
    threadId: ThreadId,
  ) => Effect.Effect<void, BrowserServiceError>;
  readonly events: Stream.Stream<BrowserEvent>;
}

export class BrowserService extends Context.Service<BrowserService, BrowserServiceShape>()(
  "ryco/browser/BrowserService",
) {}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultMode(input: BrowserOpenSessionInput): BrowserProfileMode {
  return input.profileMode ?? (input.projectId ? "project" : "thread");
}

function profileIdFor(input: BrowserOpenSessionInput): BrowserProfileId {
  const mode = defaultMode(input);
  const basis =
    input.profileName ??
    (mode === "project" && input.projectId
      ? `project:${input.projectId}`
      : `thread:${input.threadId}`);
  return BrowserProfileId.make(`browser-profile:${sanitizeBrowserProfileKey(`${mode}:${basis}`)}`);
}

function profileFor(input: BrowserOpenSessionInput): BrowserProfile {
  const timestamp = nowIso();
  const mode = defaultMode(input);
  const profileId = profileIdFor(input);
  return {
    profileId,
    displayName: input.profileName ?? (mode === "project" ? "Project" : "Thread"),
    mode,
    persistent: mode !== "temporary",
    scope: {
      mode,
      threadId: input.threadId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.profileName ? { name: input.profileName } : {}),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function blankNavigation() {
  return {
    url: "about:blank",
    origin: null,
    title: "New Tab",
    loadState: "idle" as const,
    canGoBack: false,
    canGoForward: false,
  };
}

function makeSession(
  input: BrowserOpenSessionInput,
  profile: BrowserProfile,
): BrowserSessionSnapshot {
  const timestamp = nowIso();
  const sessionId = BrowserSessionId.make(`browser-session:${crypto.randomUUID()}`);
  const tabId = BrowserTabId.make(`browser-tab:${crypto.randomUUID()}`);
  const tab = {
    tabId,
    sessionId,
    profileId: profile.profileId,
    selected: true,
    crashed: false,
    navigation: blankNavigation(),
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies BrowserTabSnapshot;

  return {
    sessionId,
    profileId: profile.profileId,
    threadId: input.threadId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    selectedTabId: tabId,
    tabs: [tab],
    status: "opening",
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies BrowserSessionSnapshot;
}

type BrowserServiceErrorCode =
  | "host_unavailable"
  | "profile_locked"
  | "session_not_found"
  | "tab_not_found"
  | "navigation_blocked"
  | "origin_denied"
  | "permission_denied"
  | "command_timeout"
  | "unsupported_capability"
  | "invalid_url"
  | "queue_full"
  | "host_disconnected";

function browserError(
  code: BrowserServiceErrorCode,
  message: string,
  retryable = false,
): BrowserServiceError {
  return new BrowserServiceError({ code, message, retryable });
}

function selectedTab(
  session: BrowserSessionSnapshot,
  explicitTabId?: BrowserTabId,
): Effect.Effect<BrowserTabSnapshot, BrowserServiceError> {
  const tabId = explicitTabId ?? session.selectedTabId;
  const tab = session.tabs.find((candidate) => candidate.tabId === tabId);
  if (!tab) {
    return Effect.fail(browserError("tab_not_found", "Browser tab not found."));
  }
  return Effect.succeed(tab);
}

function mapCommandFailure(code: string, message: string, retryable: boolean): BrowserServiceError {
  const knownCodes = new Set<BrowserServiceErrorCode>([
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
  ]);
  const serviceCode = knownCodes.has(code as BrowserServiceErrorCode)
    ? (code as BrowserServiceErrorCode)
    : "unsupported_capability";
  return browserError(serviceCode, message, retryable);
}

function enforceNavigationAccess(input: {
  readonly decision: import("@ryco/contracts").BrowserToolAccessDecision;
  readonly source?: "ui" | "agent";
}): Effect.Effect<void, BrowserServiceError> {
  if (input.decision.decision === "deny") {
    return Effect.fail(
      browserError(
        "origin_denied",
        input.decision.reason ?? "Navigation denied by browser policy.",
      ),
    );
  }
  if (input.decision.decision === "ask" && input.source === "agent") {
    return Effect.fail(
      browserError(
        "origin_denied",
        input.decision.reason ??
          "Origin requires explicit approval before provider-driven browser navigation.",
        false,
      ),
    );
  }
  return Effect.void;
}

export const BrowserServiceLive = Layer.effect(
  BrowserService,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const registry = yield* BrowserHostRegistry;
    const policy = yield* BrowserPolicy;
    const artifactStoreOption = yield* Effect.serviceOption(BrowserArtifactStore);
    const state = yield* Ref.make<BrowserServiceState>({
      profiles: new Map(),
      sessions: new Map(),
      sessionOwners: new Map(),
    });
    const serviceEvents = yield* PubSub.unbounded<BrowserEvent>();

    const requireArtifactStore = Effect.gen(function* () {
      const store = Option.getOrUndefined(artifactStoreOption);
      if (!store) {
        return yield* Effect.fail(
          browserError("unsupported_capability", "Browser artifact store is unavailable."),
        );
      }
      return store;
    });

    const publish = (event: BrowserEvent) =>
      PubSub.publish(serviceEvents, event).pipe(Effect.asVoid);

    const failIfUnsupported = Effect.fail(
      browserError(
        "unsupported_capability",
        "Built-in browser is available only for the local Ryco desktop backend.",
      ),
    );

    const requireDesktop = config.mode === "desktop" ? Effect.void : failIfUnsupported;

    const loadSession = (
      input:
        | BrowserSessionInput
        | BrowserControlInput
        | BrowserNavigateInput
        | BrowserStorageInspectInput
        | BrowserStorageClearInput
        | BrowserCookieDeleteInput
        | BrowserWaitForInput,
    ) =>
      Ref.get(state).pipe(
        Effect.flatMap((current) => {
          const session = current.sessions.get(input.sessionId);
          if (!session || session.status === "closed") {
            return Effect.fail(browserError("session_not_found", "Browser session not found."));
          }
          return Effect.succeed(session);
        }),
      );

    const saveSession = (session: BrowserSessionSnapshot) =>
      Effect.gen(function* () {
        yield* Ref.update(state, (current) => {
          const sessions = new Map(current.sessions);
          sessions.set(session.sessionId, session);
          return { ...current, sessions };
        });
        yield* publish({
          type: "session.updated",
          session,
          createdAt: nowIso(),
        });
        return session;
      });

    const executeSessionCommand = (input: {
      readonly command: Parameters<typeof registry.sendCommand>[0]["command"];
      readonly fallbackSession: BrowserSessionSnapshot;
    }) =>
      registry.sendCommand({ command: input.command }).pipe(
        Effect.flatMap((result) => {
          if (!result.ok) {
            return Effect.fail(
              mapCommandFailure(result.error.code, result.error.message, result.error.retryable),
            );
          }
          return saveSession(result.result.session ?? input.fallbackSession);
        }),
      );

    const executeInspectionCommand = (input: {
      readonly command: Parameters<typeof registry.sendCommand>[0]["command"];
    }) =>
      registry.sendCommand({ command: input.command }).pipe(
        Effect.flatMap((result) => {
          if (!result.ok) {
            return Effect.fail(
              mapCommandFailure(result.error.code, result.error.message, result.error.retryable),
            );
          }
          const inspection = result.result.storageInspection;
          if (!inspection) {
            return Effect.fail(
              browserError(
                "unsupported_capability",
                "Browser host did not return a storage inspection payload.",
              ),
            );
          }
          return saveSession(inspection.session).pipe(Effect.as(inspection));
        }),
      );

    const executeClearStorageCommand = (input: {
      readonly command: Parameters<typeof registry.sendCommand>[0]["command"];
    }) =>
      registry.sendCommand({ command: input.command }).pipe(
        Effect.flatMap((result) => {
          if (!result.ok) {
            return Effect.fail(
              mapCommandFailure(result.error.code, result.error.message, result.error.retryable),
            );
          }
          const clear = result.result.storageClear;
          if (!clear) {
            return Effect.fail(
              browserError(
                "unsupported_capability",
                "Browser host did not return a storage clear payload.",
              ),
            );
          }
          return saveSession(clear.session).pipe(Effect.as(clear));
        }),
      );

    const executeDeleteCookieCommand = (input: {
      readonly command: Parameters<typeof registry.sendCommand>[0]["command"];
    }) =>
      registry.sendCommand({ command: input.command }).pipe(
        Effect.flatMap((result) => {
          if (!result.ok) {
            return Effect.fail(
              mapCommandFailure(result.error.code, result.error.message, result.error.retryable),
            );
          }
          const deleted = result.result.cookieDelete;
          if (!deleted) {
            return Effect.fail(
              browserError(
                "unsupported_capability",
                "Browser host did not return a cookie delete payload.",
              ),
            );
          }
          return saveSession(deleted.session).pipe(Effect.as(deleted));
        }),
      );

    const executeHostDataCommand = (input: {
      readonly command: Parameters<typeof registry.sendCommand>[0]["command"];
    }) =>
      registry.sendCommand({ command: input.command }).pipe(
        Effect.flatMap((result) => {
          if (!result.ok) {
            return Effect.fail(
              mapCommandFailure(result.error.code, result.error.message, result.error.retryable),
            );
          }
          const session = result.result.session;
          if (!session) {
            return Effect.fail(
              browserError(
                "unsupported_capability",
                "Browser host did not return an updated session snapshot.",
              ),
            );
          }
          return saveSession(session).pipe(Effect.as(result.result));
        }),
      );

    const dispatchObservationCommand = (input: {
      readonly session: BrowserSessionSnapshot;
      readonly tab: BrowserTabSnapshot;
      readonly kind: "snapshot_dom" | "screenshot" | "read_console" | "read_network";
    }) =>
      executeHostDataCommand({
        command: {
          kind: input.kind,
          sessionId: input.session.sessionId,
          tabId: input.tab.tabId,
        },
      });

    const matchesWaitCondition = (input: {
      readonly wait: BrowserWaitForInput;
      readonly session: BrowserSessionSnapshot;
      readonly tab: BrowserTabSnapshot;
      readonly visibleText?: string;
    }) => {
      const { wait, tab, visibleText } = input;
      if (wait.url !== undefined && tab.navigation.url !== wait.url) return false;
      if (wait.title !== undefined && tab.navigation.title !== wait.title) return false;
      if (wait.loadState !== undefined && tab.navigation.loadState !== wait.loadState) return false;
      if (wait.text !== undefined && !(visibleText ?? "").includes(wait.text)) return false;
      if (wait.textGone !== undefined && (visibleText ?? "").includes(wait.textGone)) return false;
      return true;
    };

    const updateTabNavigation = (input: {
      readonly session: BrowserSessionSnapshot;
      readonly tab: BrowserTabSnapshot;
      readonly url?: string;
      readonly origin?: string | null;
      readonly loadState?: BrowserTabSnapshot["navigation"]["loadState"];
    }) => {
      const timestamp = nowIso();
      const nextTab = {
        ...input.tab,
        navigation: {
          ...input.tab.navigation,
          ...(input.url ? { url: input.url } : {}),
          ...(input.origin !== undefined ? { origin: input.origin } : {}),
          ...(input.loadState ? { loadState: input.loadState } : {}),
        },
        updatedAt: timestamp,
      } satisfies BrowserTabSnapshot;
      return {
        ...input.session,
        status: "ready" as const,
        tabs: input.session.tabs.map((tab) => (tab.tabId === nextTab.tabId ? nextTab : tab)),
        selectedTabId: nextTab.tabId,
        updatedAt: timestamp,
      } satisfies BrowserSessionSnapshot;
    };

    return {
      getStatus: Effect.gen(function* () {
        const [current, host] = yield* Effect.all([Ref.get(state), registry.snapshot]);
        if (config.mode !== "desktop") {
          return {
            supported: false,
            reason: "remote_unsupported",
            host: null,
            sessions: [...current.sessions.values()],
          } satisfies BrowserStatusSnapshot;
        }
        return {
          supported: host.host?.connected === true,
          ...(host.host?.connected === true ? {} : { reason: "desktop_host_missing" as const }),
          host: host.host,
          sessions: [...current.sessions.values()],
        } satisfies BrowserStatusSnapshot;
      }),
      listProfiles: Ref.get(state).pipe(
        Effect.map(
          (current) =>
            ({
              profiles: [...current.profiles.values()],
            }) satisfies BrowserListProfilesResult,
        ),
      ),
      openSession: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const profile = profileFor(input);
          const current = yield* Ref.get(state);
          const existing = [...current.sessions.values()].find(
            (session) => session.profileId === profile.profileId && session.status !== "closed",
          );
          if (existing) {
            if (existing.threadId === input.threadId) return existing;
            return yield* browserError(
              "profile_locked",
              "Browser profile is already attached to another session.",
            );
          }

          const sessionOwner = input.source === "agent" ? "agent" : "ui";
          const initialNavigation = input.initialUrl
            ? yield* policy.decideNavigation({ rawUrl: input.initialUrl })
            : null;
          if (initialNavigation) {
            yield* enforceNavigationAccess({
              decision: initialNavigation.decision,
              source: input.source ?? "ui",
            });
          }

          const baseSession = makeSession(input, profile);
          const initialTab = baseSession.tabs[0];
          const session =
            initialNavigation && initialTab
              ? updateTabNavigation({
                  session: baseSession,
                  tab: initialTab,
                  url: initialNavigation.url,
                  origin: initialNavigation.origin,
                  loadState: "loading",
                })
              : baseSession;
          yield* Ref.update(state, (latest) => {
            const profiles = new Map(latest.profiles);
            profiles.set(profile.profileId, profile);
            const sessions = new Map(latest.sessions);
            sessions.set(session.sessionId, session);
            const sessionOwners = new Map(latest.sessionOwners);
            sessionOwners.set(session.sessionId, sessionOwner);
            return { profiles, sessions, sessionOwners };
          });

          return yield* executeSessionCommand({
            command: {
              kind: "open_session",
              session,
              profile,
              ...(initialNavigation ? { initialUrl: initialNavigation.url } : {}),
            },
            fallbackSession: {
              ...session,
              status: "ready",
              updatedAt: nowIso(),
            },
          });
        }),
      closeSession: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const closedSession = {
            ...session,
            status: "closed" as const,
            updatedAt: nowIso(),
          };
          const snapshot = yield* executeSessionCommand({
            command: {
              kind: "close_session",
              sessionId: session.sessionId,
            },
            fallbackSession: closedSession,
          });
          yield* Ref.update(state, (current) => {
            const sessionOwners = new Map(current.sessionOwners);
            sessionOwners.delete(session.sessionId);
            return { ...current, sessionOwners };
          });
          yield* publish({
            type: "session.closed",
            sessionId: snapshot.sessionId,
            createdAt: nowIso(),
          });
          return snapshot;
        }),
      closeAgentSessionsForThread: (threadId) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const current = yield* Ref.get(state);
          const agentSessions = [...current.sessions.values()].filter(
            (session) =>
              session.threadId === threadId &&
              session.status !== "closed" &&
              current.sessionOwners.get(session.sessionId) === "agent",
          );
          yield* Effect.forEach(
            agentSessions,
            (session) =>
              Effect.gen(function* () {
                const closedSession = {
                  ...session,
                  status: "closed" as const,
                  updatedAt: nowIso(),
                };
                const snapshot = yield* executeSessionCommand({
                  command: {
                    kind: "close_session",
                    sessionId: session.sessionId,
                  },
                  fallbackSession: closedSession,
                }).pipe(
                  Effect.catch(() => saveSession(closedSession).pipe(Effect.as(closedSession))),
                );
                yield* Ref.update(state, (latest) => {
                  const sessionOwners = new Map(latest.sessionOwners);
                  sessionOwners.delete(session.sessionId);
                  return { ...latest, sessionOwners };
                });
                yield* publish({
                  type: "session.closed",
                  sessionId: snapshot.sessionId,
                  createdAt: nowIso(),
                });
              }),
            { concurrency: 1, discard: true },
          );
        }),
      getSnapshot: loadSession,
      navigate: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          const decision = yield* policy.decideNavigation({ rawUrl: input.url });
          yield* enforceNavigationAccess({
            decision: decision.decision,
            source: input.source ?? "ui",
          });
          const fallbackSession = updateTabNavigation({
            session,
            tab,
            url: decision.url,
            origin: decision.origin,
            loadState: "loading",
          });
          return yield* executeSessionCommand({
            command: {
              kind: "navigate",
              sessionId: session.sessionId,
              tabId: tab.tabId,
              url: decision.url,
            },
            fallbackSession,
          });
        }),
      back: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          return yield* executeSessionCommand({
            command: { kind: "back", sessionId: session.sessionId, tabId: tab.tabId },
            fallbackSession: session,
          });
        }),
      forward: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          return yield* executeSessionCommand({
            command: { kind: "forward", sessionId: session.sessionId, tabId: tab.tabId },
            fallbackSession: session,
          });
        }),
      reload: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          return yield* executeSessionCommand({
            command: { kind: "reload", sessionId: session.sessionId, tabId: tab.tabId },
            fallbackSession: session,
          });
        }),
      stop: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          return yield* executeSessionCommand({
            command: { kind: "stop", sessionId: session.sessionId, tabId: tab.tabId },
            fallbackSession: session,
          });
        }),
      input: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          return yield* executeSessionCommand({
            command: {
              kind: "input",
              sessionId: session.sessionId,
              tabId: tab.tabId,
              action: input.action,
            },
            fallbackSession: session,
          });
        }),
      inspectStorage: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          return yield* executeInspectionCommand({
            command: {
              kind: "inspect_storage",
              sessionId: session.sessionId,
              tabId: tab.tabId,
            },
          });
        }),
      clearStorage: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          return yield* executeClearStorageCommand({
            command: {
              kind: "clear_storage",
              sessionId: session.sessionId,
              tabId: tab.tabId,
              scope: input.scope,
              dataTypes: input.dataTypes,
            },
          });
        }),
      deleteCookie: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          return yield* executeDeleteCookieCommand({
            command: {
              kind: "delete_cookie",
              sessionId: session.sessionId,
              tabId: tab.tabId,
              ...(input.url ? { url: input.url } : {}),
              name: input.name,
              ...(input.domain ? { domain: input.domain } : {}),
              ...(input.path ? { path: input.path } : {}),
              ...(input.secure !== undefined ? { secure: input.secure } : {}),
            },
          });
        }),
      snapshotDom: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          const payload = yield* dispatchObservationCommand({
            session,
            tab,
            kind: "snapshot_dom",
          });
          const data = decodeBrowserHostDomSnapshotData(payload.data);
          if (!data) {
            return yield* browserError(
              "unsupported_capability",
              "Browser host did not return a DOM snapshot payload.",
            );
          }
          const updatedSession = payload.session ?? session;
          const snapshotJson = JSON.stringify(data.snapshot);
          if (snapshotJson.length > 65_536) {
            const artifactStore = yield* requireArtifactStore;
            const artifact = yield* artifactStore
              .put({
                kind: "dom_snapshot",
                mimeType: "application/json",
                data: new TextEncoder().encode(snapshotJson),
                profileId: updatedSession.profileId,
                sessionId: updatedSession.sessionId,
                tabId: tab.tabId,
                url: data.snapshot.url,
                origin: tab.navigation.origin,
              })
              .pipe(
                Effect.mapError((error) =>
                  browserError(
                    "unsupported_capability",
                    error instanceof Error ? error.message : "Failed to store browser artifact.",
                    true,
                  ),
                ),
              );
            return {
              session: updatedSession,
              snapshot: {
                url: data.snapshot.url,
                title: data.snapshot.title,
                viewport: data.snapshot.viewport,
                tree: [],
                truncated: true,
                nodeCount: data.snapshot.nodeCount,
              },
              ...(data.text ? { text: data.text } : {}),
              artifact,
            } satisfies BrowserDomSnapshotResult;
          }
          return {
            session: updatedSession,
            snapshot: data.snapshot,
            ...(data.text ? { text: data.text } : {}),
          } satisfies BrowserDomSnapshotResult;
        }),
      screenshot: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          const payload = yield* dispatchObservationCommand({
            session,
            tab,
            kind: "screenshot",
          });
          const data = decodeBrowserHostScreenshotData(payload.data);
          if (!data) {
            return yield* browserError(
              "unsupported_capability",
              "Browser host did not return a screenshot payload.",
            );
          }
          const updatedSession = payload.session ?? session;
          const bytes = base64ToUint8Array(data.base64);
          const artifactStore = yield* requireArtifactStore;
          const artifact = yield* artifactStore
            .put({
              kind: "screenshot",
              mimeType: "image/png",
              data: bytes,
              profileId: updatedSession.profileId,
              sessionId: updatedSession.sessionId,
              tabId: tab.tabId,
              url: tab.navigation.url,
              origin: tab.navigation.origin,
            })
            .pipe(
              Effect.mapError((error) =>
                browserError(
                  "unsupported_capability",
                  error instanceof Error ? error.message : "Failed to store browser screenshot.",
                  true,
                ),
              ),
            );
          return {
            session: updatedSession,
            artifact,
          } satisfies BrowserScreenshotResult;
        }),
      readConsole: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          const payload = yield* dispatchObservationCommand({
            session,
            tab,
            kind: "read_console",
          });
          const data = decodeBrowserHostConsoleData(payload.data);
          if (!data) {
            return yield* browserError(
              "unsupported_capability",
              "Browser host did not return a console payload.",
            );
          }
          return {
            session: payload.session ?? session,
            entries: data.entries,
          } satisfies BrowserConsoleResult;
        }),
      readNetwork: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          const payload = yield* dispatchObservationCommand({
            session,
            tab,
            kind: "read_network",
          });
          const data = decodeBrowserHostNetworkData(payload.data);
          if (!data) {
            return yield* browserError(
              "unsupported_capability",
              "Browser host did not return a network payload.",
            );
          }
          return {
            session: payload.session ?? session,
            entries: data.entries,
          } satisfies BrowserNetworkResult;
        }),
      waitFor: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const timeoutMs = input.timeoutMs ?? 30_000;
          const startedAt = Date.now();
          const needsVisibleText = input.text !== undefined || input.textGone !== undefined;
          while (Date.now() - startedAt < timeoutMs) {
            const session = yield* loadSession(input);
            const tab = yield* selectedTab(session, input.tabId);
            const visibleText = needsVisibleText
              ? yield* dispatchObservationCommand({ session, tab, kind: "snapshot_dom" }).pipe(
                  Effect.flatMap((payload) => {
                    const data = decodeBrowserHostDomSnapshotData(payload.data);
                    return Effect.succeed(data?.text ?? payload.text ?? "");
                  }),
                )
              : undefined;
            if (
              matchesWaitCondition({
                wait: input,
                session,
                tab,
                ...(visibleText !== undefined ? { visibleText } : {}),
              })
            ) {
              return {
                session,
                matched: true,
                waitedMs: Date.now() - startedAt,
              } satisfies BrowserWaitForResult;
            }
            yield* Effect.sleep(250);
          }
          const session = yield* loadSession(input);
          return {
            session,
            matched: false,
            waitedMs: Date.now() - startedAt,
          } satisfies BrowserWaitForResult;
        }),
      get events() {
        return Stream.merge(registry.eventStream, Stream.fromPubSub(serviceEvents));
      },
    } satisfies BrowserServiceShape;
  }),
);

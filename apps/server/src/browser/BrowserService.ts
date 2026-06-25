import { sanitizeBrowserProfileKey } from "@ryco/shared/browser";
import { Context, Effect, Layer, PubSub, Ref, Stream } from "effect";

import {
  BrowserProfileId,
  BrowserServiceError,
  BrowserSessionId,
  BrowserTabId,
  type BrowserCookieDeleteInput,
  type BrowserCookieDeleteResult,
  type BrowserControlInput,
  type BrowserEvent,
  type BrowserInputCommandInput,
  type BrowserListProfilesResult,
  type BrowserNavigateInput,
  type BrowserOpenSessionInput,
  type BrowserProfile,
  type BrowserProfileMode,
  type BrowserSessionInput,
  type BrowserSessionSnapshot,
  type BrowserStorageClearInput,
  type BrowserStorageClearResult,
  type BrowserStorageInspectInput,
  type BrowserStorageInspectionResult,
  type BrowserStatusSnapshot,
  type BrowserTabSnapshot,
} from "@ryco/contracts";

import { ServerConfig } from "../config.ts";
import { BrowserHostRegistry } from "./BrowserHostRegistry.ts";
import { BrowserPolicy } from "./BrowserPolicy.ts";

interface BrowserServiceState {
  readonly profiles: ReadonlyMap<string, BrowserProfile>;
  readonly sessions: ReadonlyMap<string, BrowserSessionSnapshot>;
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

export const BrowserServiceLive = Layer.effect(
  BrowserService,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const registry = yield* BrowserHostRegistry;
    const policy = yield* BrowserPolicy;
    const state = yield* Ref.make<BrowserServiceState>({
      profiles: new Map(),
      sessions: new Map(),
    });
    const serviceEvents = yield* PubSub.unbounded<BrowserEvent>();

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
        | BrowserCookieDeleteInput,
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

          const initialNavigation = input.initialUrl
            ? yield* policy.decideNavigation({ rawUrl: input.initialUrl })
            : null;
          if (initialNavigation?.decision.decision === "deny") {
            return yield* browserError(
              "origin_denied",
              initialNavigation.decision.reason ?? "Navigation denied by browser policy.",
            );
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
            return { profiles, sessions };
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
          yield* publish({
            type: "session.closed",
            sessionId: snapshot.sessionId,
            createdAt: nowIso(),
          });
          return snapshot;
        }),
      getSnapshot: loadSession,
      navigate: (input) =>
        Effect.gen(function* () {
          yield* requireDesktop;
          const session = yield* loadSession(input);
          const tab = yield* selectedTab(session, input.tabId);
          const decision = yield* policy.decideNavigation({ rawUrl: input.url });
          if (decision.decision.decision === "deny") {
            return yield* browserError(
              "origin_denied",
              decision.decision.reason ?? "Navigation denied by browser policy.",
            );
          }
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
      get events() {
        return Stream.merge(registry.eventStream, Stream.fromPubSub(serviceEvents));
      },
    } satisfies BrowserServiceShape;
  }),
);

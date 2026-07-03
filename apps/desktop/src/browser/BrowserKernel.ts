import { WebContentsView } from "electron";
import type { WebContents } from "electron";
import { BrowserTabId } from "@ryco/contracts";
import type {
  BrowserEvent,
  BrowserHostCommandEnvelope,
  BrowserCommandResult,
  BrowserCommandResultPayload,
  BrowserCookieDeleteResult,
  BrowserDomBounds,
  BrowserDomNode,
  BrowserInputAction,
  BrowserProfile,
  BrowserSessionSnapshot,
  BrowserStorageClearResult,
  BrowserStorageDataType,
  BrowserStorageEntryMetadata,
  BrowserStorageInspectionResult,
  BrowserTabSnapshot,
} from "@ryco/contracts";

import { BrowserProfiles } from "./BrowserProfiles.ts";
import {
  browserCookieMetadata,
  browserCookieRemovalUrl,
  canUseBrowserCookieUrl,
  electronStorageTypes,
  sanitizeBrowserStorageEntries,
} from "./BrowserStorageHelpers.ts";
import {
  BROWSER_CONSOLE_BUFFER_LIMIT,
  BROWSER_DOM_SNAPSHOT_SCRIPT,
  BROWSER_MAX_SCREENSHOT_BYTES,
  BROWSER_NETWORK_BUFFER_LIMIT,
  type BufferedConsoleEntry,
  type BufferedNetworkEntry,
  parseConsoleMessage,
  pushBounded,
} from "./BrowserObservationHelpers.ts";

type EventSink = (event: BrowserEvent) => Promise<void> | void;

interface HostedSession {
  session: BrowserSessionSnapshot;
  view: WebContentsView;
  consoleEntries: BufferedConsoleEntry[];
  networkEntries: BufferedNetworkEntry[];
  networkRequestStartedAt: Map<string, string>;
}

function commandFailure(
  commandId: BrowserHostCommandEnvelope["commandId"],
  code: string,
  message: string,
  retryable = false,
): BrowserCommandResult {
  return {
    ok: false,
    commandId,
    error: {
      code,
      message,
      retryable,
    },
  };
}

function commandSuccess(
  commandId: BrowserHostCommandEnvelope["commandId"],
  session: BrowserSessionSnapshot,
  payload: Omit<BrowserCommandResultPayload, "session"> = {},
): BrowserCommandResult {
  return {
    ok: true,
    commandId,
    result: {
      session,
      ...payload,
    },
  };
}

function webContentsNavigation(webContents: WebContents) {
  const url = webContents.getURL() || "about:blank";
  let origin: string | null = null;
  try {
    const parsed = new URL(url);
    origin = parsed.origin === "null" ? null : parsed.origin;
  } catch {
    origin = null;
  }
  return {
    url,
    origin,
    title: webContents.getTitle() || "New Tab",
    loadState: webContents.isLoading() ? "loading" : "loaded",
    canGoBack: webContents.navigationHistory?.canGoBack() ?? webContents.canGoBack(),
    canGoForward: webContents.navigationHistory?.canGoForward() ?? webContents.canGoForward(),
  } satisfies BrowserTabSnapshot["navigation"];
}

function parseOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
}

function uniqueStrings(values: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function flattenDomRefBounds(nodes: ReadonlyArray<BrowserDomNode>): Map<string, BrowserDomBounds> {
  const refs = new Map<string, BrowserDomBounds>();
  const walk = (node: BrowserDomNode) => {
    if (node.bounds) {
      refs.set(node.ref, node.bounds);
    }
    node.children?.forEach(walk);
  };
  for (const node of nodes) {
    walk(node);
  }
  return refs;
}

function resolveClickCoordinates(
  action: Extract<BrowserInputAction, { readonly type: "click" }>,
  refs: Map<string, BrowserDomBounds> | undefined,
): { readonly x: number; readonly y: number } {
  if ("ref" in action) {
    const bounds = refs?.get(action.ref);
    if (!bounds) {
      throw new Error(`Unknown DOM ref '${action.ref}'. Run snapshot_dom first.`);
    }
    return {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
  }
  return { x: action.x, y: action.y };
}

export class BrowserKernel {
  private readonly profiles = new BrowserProfiles();
  private readonly sessions = new Map<string, HostedSession>();
  private readonly domRefCache = new Map<string, Map<string, BrowserDomBounds>>();
  private eventSink: EventSink = () => undefined;

  setEventSink(eventSink: EventSink): void {
    this.eventSink = eventSink;
  }

  getView(sessionId: string, tabId: string): WebContentsView | null {
    const hosted = this.sessions.get(sessionId);
    if (!hosted || hosted.session.selectedTabId !== tabId) return null;
    return hosted.view;
  }

  async execute(envelope: BrowserHostCommandEnvelope): Promise<BrowserCommandResult> {
    const { command, commandId } = envelope;
    try {
      switch (command.kind) {
        case "open_session":
          return commandSuccess(
            commandId,
            await this.openSession(command.session, command.profile, command.initialUrl),
          );
        case "close_session":
          return commandSuccess(commandId, await this.closeSession(command.sessionId));
        case "navigate":
          return commandSuccess(
            commandId,
            await this.withHosted(command.sessionId, command.tabId, async (hosted) => {
              await hosted.view.webContents.loadURL(command.url);
              return this.updateSnapshotFromWebContents(hosted);
            }),
          );
        case "back":
          return commandSuccess(
            commandId,
            await this.navigationAction(command.sessionId, command.tabId, "back"),
          );
        case "forward":
          return commandSuccess(
            commandId,
            await this.navigationAction(command.sessionId, command.tabId, "forward"),
          );
        case "reload":
          return commandSuccess(
            commandId,
            await this.navigationAction(command.sessionId, command.tabId, "reload"),
          );
        case "stop":
          return commandSuccess(
            commandId,
            await this.navigationAction(command.sessionId, command.tabId, "stop"),
          );
        case "input":
          return commandSuccess(
            commandId,
            await this.input(command.sessionId, command.tabId, command.action),
          );
        case "snapshot_dom":
          return commandSuccess(
            commandId,
            await this.snapshot(command.sessionId, command.tabId),
            await this.snapshotDomPayload(command.sessionId, command.tabId),
          );
        case "inspect_storage":
          return commandSuccess(commandId, await this.snapshot(command.sessionId, command.tabId), {
            storageInspection: await this.inspectStorage(command.sessionId, command.tabId),
          });
        case "clear_storage":
          return commandSuccess(commandId, await this.snapshot(command.sessionId, command.tabId), {
            storageClear: await this.clearStorage(
              command.sessionId,
              command.tabId,
              command.scope,
              command.dataTypes,
            ),
          });
        case "delete_cookie":
          return commandSuccess(commandId, await this.snapshot(command.sessionId, command.tabId), {
            cookieDelete: await this.deleteCookie(command.sessionId, command.tabId, {
              ...(command.url ? { url: command.url } : {}),
              name: command.name,
              ...(command.domain ? { domain: command.domain } : {}),
              ...(command.path ? { path: command.path } : {}),
              ...(command.secure !== undefined ? { secure: command.secure } : {}),
            }),
          });
        case "screenshot":
          return commandSuccess(
            commandId,
            await this.snapshot(command.sessionId, command.tabId),
            await this.screenshotPayload(command.sessionId, command.tabId),
          );
        case "read_console":
          return commandSuccess(
            commandId,
            await this.snapshot(command.sessionId, command.tabId),
            await this.consolePayload(command.sessionId, command.tabId),
          );
        case "read_network":
          return commandSuccess(
            commandId,
            await this.snapshot(command.sessionId, command.tabId),
            await this.networkPayload(command.sessionId, command.tabId),
          );
      }
    } catch (error) {
      return commandFailure(
        commandId,
        "unsupported_capability",
        error instanceof Error ? error.message : "Browser host command failed.",
      );
    }
  }

  private async openSession(
    session: BrowserSessionSnapshot,
    profile: BrowserProfile,
    initialUrl: string | undefined,
  ): Promise<BrowserSessionSnapshot> {
    const tab = session.tabs.find((candidate) => candidate.tabId === session.selectedTabId);
    if (!tab) throw new Error("Browser session has no selected tab.");
    const browserSession = this.profiles.resolve(profile);
    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        webSecurity: true,
      },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const hosted: HostedSession = {
      session: { ...session, status: "ready" },
      view,
      consoleEntries: [],
      networkEntries: [],
      networkRequestStartedAt: new Map(),
    };
    this.sessions.set(session.sessionId, hosted);
    this.installWebContentsListeners(hosted);
    await view.webContents.loadURL(initialUrl ?? "about:blank").catch(() => undefined);
    return this.updateSnapshotFromWebContents(hosted);
  }

  private async closeSession(sessionId: string): Promise<BrowserSessionSnapshot> {
    const hosted = this.sessions.get(sessionId);
    if (!hosted) throw new Error("Browser session not found.");
    this.sessions.delete(sessionId);
    for (const key of this.domRefCache.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.domRefCache.delete(key);
      }
    }
    hosted.view.webContents.close({ waitForBeforeUnload: false });
    const closed = {
      ...hosted.session,
      status: "closed" as const,
      updatedAt: new Date().toISOString(),
    };
    await this.emit({
      type: "session.closed",
      sessionId: closed.sessionId,
      createdAt: closed.updatedAt,
    });
    return closed;
  }

  private async navigationAction(
    sessionId: string,
    tabId: string,
    action: "back" | "forward" | "reload" | "stop",
  ): Promise<BrowserSessionSnapshot> {
    return this.withHosted(sessionId, tabId, async (hosted) => {
      const { webContents } = hosted.view;
      if (action === "back" && webContents.canGoBack()) webContents.goBack();
      if (action === "forward" && webContents.canGoForward()) webContents.goForward();
      if (action === "reload") webContents.reload();
      if (action === "stop") webContents.stop();
      return this.updateSnapshotFromWebContents(hosted);
    });
  }

  private async input(
    sessionId: string,
    tabId: string,
    action: BrowserInputAction,
  ): Promise<BrowserSessionSnapshot> {
    return this.withHosted(sessionId, tabId, async (hosted) => {
      const { webContents } = hosted.view;
      if (action.type === "click") {
        const { x, y } = resolveClickCoordinates(
          action,
          this.domRefCache.get(`${sessionId}:${tabId}`),
        );
        webContents.sendInputEvent({
          type: "mouseDown",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        webContents.sendInputEvent({
          type: "mouseUp",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
      } else if (action.type === "type") {
        webContents.insertText(action.text);
      } else if (action.type === "key") {
        webContents.sendInputEvent({ type: "keyDown", keyCode: action.key });
        webContents.sendInputEvent({ type: "keyUp", keyCode: action.key });
      } else if (action.type === "scroll") {
        webContents.sendInputEvent({
          type: "mouseWheel",
          x: 0,
          y: 0,
          deltaX: action.deltaX,
          deltaY: action.deltaY,
        });
      }
      return this.updateSnapshotFromWebContents(hosted);
    });
  }

  private async snapshot(sessionId: string, tabId: string): Promise<BrowserSessionSnapshot> {
    return this.withHosted(sessionId, tabId, async (hosted) =>
      this.updateSnapshotFromWebContents(hosted),
    );
  }

  private async snapshotDomPayload(sessionId: string, tabId: string) {
    return this.withHosted(sessionId, tabId, async (hosted) => {
      const { webContents } = hosted.view;
      const snapshot = await webContents.executeJavaScript(BROWSER_DOM_SNAPSHOT_SCRIPT, true);
      if (snapshot && typeof snapshot === "object" && Array.isArray(snapshot.tree)) {
        this.domRefCache.set(
          `${sessionId}:${tabId}`,
          flattenDomRefBounds(snapshot.tree as ReadonlyArray<BrowserDomNode>),
        );
      }
      const text = await this.readTextFromWebContents(webContents);
      return {
        data: {
          kind: "dom_snapshot" as const,
          snapshot,
          text,
        },
      };
    });
  }

  private async screenshotPayload(sessionId: string, tabId: string) {
    return this.withHosted(sessionId, tabId, async (hosted) => {
      const image = await hosted.view.webContents.capturePage();
      const png = image.toPNG();
      if (png.byteLength > BROWSER_MAX_SCREENSHOT_BYTES) {
        throw new Error("Screenshot exceeds the maximum allowed size.");
      }
      return {
        data: {
          kind: "screenshot" as const,
          base64: png.toString("base64"),
        },
      };
    });
  }

  private async consolePayload(sessionId: string, tabId: string) {
    return this.withHosted(sessionId, tabId, async (hosted) => ({
      data: {
        kind: "console" as const,
        entries: [...hosted.consoleEntries],
      },
    }));
  }

  private async networkPayload(sessionId: string, tabId: string) {
    return this.withHosted(sessionId, tabId, async (hosted) => ({
      data: {
        kind: "network" as const,
        entries: [...hosted.networkEntries],
      },
    }));
  }

  private async readTextFromWebContents(webContents: WebContents): Promise<string> {
    const text = await webContents.executeJavaScript(
      "document.body ? document.body.innerText.slice(0, 20000) : ''",
      false,
    );
    return typeof text === "string" ? text : "";
  }

  private async readText(sessionId: string, tabId: string): Promise<string> {
    return this.withHosted(sessionId, tabId, async (hosted) =>
      this.readTextFromWebContents(hosted.view.webContents),
    );
  }

  private async inspectStorage(
    sessionId: string,
    tabId: string,
  ): Promise<BrowserStorageInspectionResult> {
    return this.withHosted(sessionId, tabId, async (hosted) => {
      const { webContents } = hosted.view;
      const url = webContents.getURL() || "about:blank";
      const origin = parseOrigin(url);
      const profileCookies = await webContents.session.cookies.get({});
      const currentCookies = canUseBrowserCookieUrl(url)
        ? await webContents.session.cookies.get({ url })
        : [];
      const storage = await this.readActiveWebStorage(webContents);
      const session = this.updateSnapshotFromWebContents(hosted);

      return {
        session,
        tabId: session.selectedTabId ?? BrowserTabId.make(tabId),
        profileId: session.profileId,
        url,
        origin,
        cookies: currentCookies.map(browserCookieMetadata),
        localStorage: storage.localStorage,
        sessionStorage: storage.sessionStorage,
        cookieCounts: {
          currentOrigin: currentCookies.length,
          profile: profileCookies.length,
        },
        inspectedAt: new Date().toISOString(),
      };
    });
  }

  private async clearStorage(
    sessionId: string,
    tabId: string,
    scope: "current_origin" | "profile",
    dataTypes: ReadonlyArray<BrowserStorageDataType>,
  ): Promise<BrowserStorageClearResult> {
    return this.withHosted(sessionId, tabId, async (hosted) => {
      const { webContents } = hosted.view;
      const browserSession = webContents.session;
      const url = webContents.getURL() || "about:blank";
      const origin = parseOrigin(url);
      const cleared = new Set<BrowserStorageDataType>();

      if (scope === "current_origin" && !origin) {
        throw new Error("Current browser page does not have a clearable origin.");
      }

      if (
        scope === "current_origin" &&
        dataTypes.includes("cookies") &&
        canUseBrowserCookieUrl(url)
      ) {
        const cookies = await browserSession.cookies.get({ url });
        await Promise.all(
          cookies.map((cookie) => {
            const removalUrl = browserCookieRemovalUrl({
              fallbackUrl: url,
              ...(cookie.domain ? { domain: cookie.domain } : {}),
              ...(cookie.path ? { path: cookie.path } : {}),
              ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
            });
            return removalUrl
              ? browserSession.cookies.remove(removalUrl, cookie.name).catch(() => undefined)
              : Promise.resolve();
          }),
        );
        cleared.add("cookies");
      }

      if (scope === "profile" && dataTypes.includes("cookies")) {
        await browserSession.clearStorageData({ storages: ["cookies"] });
        cleared.add("cookies");
      }

      const storageTypes = electronStorageTypes(dataTypes);
      if (storageTypes.length > 0) {
        await browserSession.clearStorageData(
          scope === "current_origin" && origin
            ? { origin, storages: storageTypes }
            : { storages: storageTypes },
        );
        for (const type of dataTypes) {
          if (type !== "cookies" && type !== "sessionStorage" && type !== "httpCache") {
            cleared.add(type);
          }
        }
      }

      if (dataTypes.includes("sessionStorage")) {
        const clearedActiveStorage = await this.clearActiveWebStorage(
          webContents,
          ["sessionStorage"],
          scope === "current_origin" ? origin : null,
        );
        if (clearedActiveStorage) cleared.add("sessionStorage");
      }

      if (dataTypes.includes("localStorage")) {
        const clearedActiveStorage = await this.clearActiveWebStorage(
          webContents,
          ["localStorage"],
          scope === "current_origin" ? origin : null,
        );
        if (clearedActiveStorage) cleared.add("localStorage");
      }

      if (dataTypes.includes("httpCache")) {
        if (scope === "current_origin" && origin) {
          await browserSession.clearData({ origins: [origin], dataTypes: ["cache"] });
        } else {
          await browserSession.clearCache();
        }
        cleared.add("httpCache");
      }

      const session = this.updateSnapshotFromWebContents(hosted);
      return {
        session,
        scope,
        origin,
        clearedDataTypes: [...cleared],
        clearedAt: new Date().toISOString(),
      };
    });
  }

  private async deleteCookie(
    sessionId: string,
    tabId: string,
    cookie: {
      readonly url?: string;
      readonly name: string;
      readonly domain?: string;
      readonly path?: string;
      readonly secure?: boolean;
    },
  ): Promise<BrowserCookieDeleteResult> {
    return this.withHosted(sessionId, tabId, async (hosted) => {
      const { webContents } = hosted.view;
      const currentUrl = webContents.getURL() || "about:blank";
      const browserSession = webContents.session;
      const filter = {
        name: cookie.name,
        ...(cookie.domain ? { domain: cookie.domain } : {}),
        ...(cookie.path ? { path: cookie.path } : {}),
        ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
      };
      const before = await browserSession.cookies.get(filter);
      const candidates = uniqueStrings([
        cookie.url && canUseBrowserCookieUrl(cookie.url) ? cookie.url : null,
        browserCookieRemovalUrl({
          fallbackUrl: cookie.url ?? currentUrl,
          ...(cookie.domain ? { domain: cookie.domain } : {}),
          ...(cookie.path ? { path: cookie.path } : {}),
          ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
        }),
        canUseBrowserCookieUrl(currentUrl) ? currentUrl : null,
      ]);

      for (const candidate of candidates) {
        await browserSession.cookies.remove(candidate, cookie.name).catch(() => undefined);
      }

      const after = await browserSession.cookies.get(filter);
      const session = this.updateSnapshotFromWebContents(hosted);
      return {
        session,
        deleted: after.length < before.length,
        cookie: {
          name: cookie.name,
          ...(cookie.domain ? { domain: cookie.domain } : {}),
          ...(cookie.path ? { path: cookie.path } : {}),
          ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
        },
        deletedAt: new Date().toISOString(),
      };
    });
  }

  private async readActiveWebStorage(webContents: WebContents): Promise<{
    readonly localStorage: BrowserStorageEntryMetadata[];
    readonly sessionStorage: BrowserStorageEntryMetadata[];
  }> {
    try {
      const result = await webContents.executeJavaScript(
        `(() => {
          const read = (storage) => {
            const entries = [];
            for (let index = 0; index < storage.length; index += 1) {
              const key = storage.key(index);
              if (typeof key !== "string") continue;
              const value = storage.getItem(key) ?? "";
              entries.push({ key, valueBytes: new Blob([value]).size });
            }
            return entries;
          };
          return {
            localStorage: read(window.localStorage),
            sessionStorage: read(window.sessionStorage),
          };
        })()`,
        false,
      );
      return {
        localStorage: sanitizeBrowserStorageEntries(result?.localStorage),
        sessionStorage: sanitizeBrowserStorageEntries(result?.sessionStorage),
      };
    } catch {
      return { localStorage: [], sessionStorage: [] };
    }
  }

  private async clearActiveWebStorage(
    webContents: WebContents,
    areas: ReadonlyArray<"localStorage" | "sessionStorage">,
    expectedOrigin: string | null,
  ): Promise<boolean> {
    if (areas.length === 0) return true;
    const script = `(() => {
      const areas = ${JSON.stringify(areas)};
      const expectedOrigin = ${JSON.stringify(expectedOrigin)};
      if (expectedOrigin !== null && window.location.origin !== expectedOrigin) return false;
      if (areas.includes("localStorage")) window.localStorage.clear();
      if (areas.includes("sessionStorage")) window.sessionStorage.clear();
      return true;
    })()`;
    const result = await webContents.executeJavaScript(script, false).catch(() => false);
    return result === true;
  }

  private async withHosted<T>(
    sessionId: string,
    tabId: string,
    operation: (hosted: HostedSession) => Promise<T>,
  ): Promise<T> {
    const hosted = this.sessions.get(sessionId);
    if (!hosted || hosted.session.selectedTabId !== tabId)
      throw new Error("Browser tab not found.");
    return operation(hosted);
  }

  private installWebContentsListeners(hosted: HostedSession): void {
    const update = () => {
      void this.emit({
        type: "session.updated",
        session: this.updateSnapshotFromWebContents(hosted),
        createdAt: new Date().toISOString(),
      });
    };
    const { webContents } = hosted.view;
    const browserSession = webContents.session;
    webContents.on("did-start-loading", update);
    webContents.on("did-stop-loading", update);
    webContents.on("page-title-updated", update);
    webContents.on("did-navigate", update);
    webContents.on("did-navigate-in-page", update);
    webContents.on("console-message", (...args: unknown[]) => {
      const entry = parseConsoleMessage(args);
      if (entry) pushBounded(hosted.consoleEntries, entry, BROWSER_CONSOLE_BUFFER_LIMIT);
    });
    const requestFilter = { urls: ["<all_urls>"] };
    browserSession.webRequest.onBeforeRequest(requestFilter, (details) => {
      hosted.networkRequestStartedAt.set(String(details.id), new Date().toISOString());
    });
    const recordNetworkEntry = (details: {
      readonly id: number;
      readonly url: string;
      readonly method: string;
      readonly statusCode?: number;
      readonly resourceType?: string;
    }) => {
      const requestId = String(details.id);
      const startedAt = hosted.networkRequestStartedAt.get(requestId) ?? new Date().toISOString();
      hosted.networkRequestStartedAt.delete(requestId);
      pushBounded(
        hosted.networkEntries,
        {
          requestId,
          url: details.url.slice(0, 8_192),
          method: details.method.slice(0, 32),
          ...("statusCode" in details && typeof details.statusCode === "number"
            ? { status: details.statusCode }
            : {}),
          ...(details.resourceType
            ? { resourceType: String(details.resourceType).slice(0, 128) }
            : {}),
          startedAt,
          completedAt: new Date().toISOString(),
        } satisfies BufferedNetworkEntry,
        BROWSER_NETWORK_BUFFER_LIMIT,
      );
    };
    browserSession.webRequest.onCompleted(requestFilter, recordNetworkEntry);
    browserSession.webRequest.onErrorOccurred(requestFilter, recordNetworkEntry);
    webContents.on("render-process-gone", (_event, details) => {
      const tab = hosted.session.tabs[0];
      if (!tab) return;
      void this.emit({
        type: "tab.crashed",
        sessionId: hosted.session.sessionId,
        tabId: tab.tabId,
        reason: details.reason,
        createdAt: new Date().toISOString(),
      });
    });
  }

  private updateSnapshotFromWebContents(hosted: HostedSession): BrowserSessionSnapshot {
    const timestamp = new Date().toISOString();
    const tab = hosted.session.tabs[0];
    if (!tab) throw new Error("Browser session has no tab.");
    const nextTab = {
      ...tab,
      navigation: webContentsNavigation(hosted.view.webContents),
      updatedAt: timestamp,
    } satisfies BrowserTabSnapshot;
    hosted.session = {
      ...hosted.session,
      status: "ready",
      selectedTabId: nextTab.tabId,
      tabs: [nextTab],
      updatedAt: timestamp,
    };
    return hosted.session;
  }

  private async emit(event: BrowserEvent): Promise<void> {
    await this.eventSink(event);
  }
}

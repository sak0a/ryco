import { WebContentsView } from "electron";
import type { WebContents } from "electron";
import { BrowserTabId } from "@ryco/contracts";
import type {
  BrowserEvent,
  BrowserHostCommandEnvelope,
  BrowserCommandResult,
  BrowserCommandResultPayload,
  BrowserCookieDeleteResult,
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

type EventSink = (event: BrowserEvent) => Promise<void> | void;

interface HostedSession {
  session: BrowserSessionSnapshot;
  view: WebContentsView;
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

export class BrowserKernel {
  private readonly profiles = new BrowserProfiles();
  private readonly sessions = new Map<string, HostedSession>();
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
          return commandSuccess(commandId, await this.snapshot(command.sessionId, command.tabId), {
            text: await this.readText(command.sessionId, command.tabId),
          });
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
        case "read_console":
        case "read_network":
          return commandFailure(
            commandId,
            "unsupported_capability",
            `${command.kind} is not implemented by the desktop browser host yet.`,
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
    const hosted: HostedSession = { session: { ...session, status: "ready" }, view };
    this.sessions.set(session.sessionId, hosted);
    this.installWebContentsListeners(hosted);
    await view.webContents.loadURL(initialUrl ?? "about:blank").catch(() => undefined);
    return this.updateSnapshotFromWebContents(hosted);
  }

  private async closeSession(sessionId: string): Promise<BrowserSessionSnapshot> {
    const hosted = this.sessions.get(sessionId);
    if (!hosted) throw new Error("Browser session not found.");
    this.sessions.delete(sessionId);
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
        webContents.sendInputEvent({
          type: "mouseDown",
          x: action.x,
          y: action.y,
          button: "left",
          clickCount: 1,
        });
        webContents.sendInputEvent({
          type: "mouseUp",
          x: action.x,
          y: action.y,
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

  private async readText(sessionId: string, tabId: string): Promise<string> {
    return this.withHosted(sessionId, tabId, async (hosted) => {
      const text = await hosted.view.webContents.executeJavaScript(
        "document.body ? document.body.innerText.slice(0, 20000) : ''",
        false,
      );
      return typeof text === "string" ? text : "";
    });
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
    hosted.view.webContents.on("did-start-loading", update);
    hosted.view.webContents.on("did-stop-loading", update);
    hosted.view.webContents.on("page-title-updated", update);
    hosted.view.webContents.on("did-navigate", update);
    hosted.view.webContents.on("did-navigate-in-page", update);
    hosted.view.webContents.on("render-process-gone", (_event, details) => {
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

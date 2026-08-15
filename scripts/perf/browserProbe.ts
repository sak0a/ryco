import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";

import type { Browser, CDPSession, Page, WebSocketRoute } from "playwright";

import {
  EMPTY_NETWORK_METRICS,
  type BrowserVitals,
  type PerfScenarioConfig,
  type PhaseNetworkMetrics,
} from "./model.ts";

type NetworkPhase = "bootstrap" | "foregroundIdle" | "hiddenIdle" | "reconnect";

interface MutableNetworkMetrics {
  requests: number;
  fetchXhrRequests: number;
  failedRequests: number;
  encodedBytes: number;
  webSocketFrames: number;
  webSocketBytes: number;
}

interface BrowserProbeResult {
  readonly reconnectMs: number | null;
  readonly foregroundTaskMs: number | null;
  readonly hiddenTaskMs: number | null;
  readonly heapBeforeIdleBytes: number | null;
  readonly heapAfterIdleBytes: number | null;
  readonly vitals: BrowserVitals;
  readonly bootstrapNetwork: PhaseNetworkMetrics;
  readonly foregroundIdleNetwork: PhaseNetworkMetrics;
  readonly hiddenIdleNetwork: PhaseNetworkMetrics;
  readonly reconnectNetwork: PhaseNetworkMetrics;
  readonly errors: readonly string[];
}

interface BrowserPerfState {
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number;
  longTasks: number;
  maxLongTaskMs: number;
}

interface NavigationTimingSnapshot {
  ttfbMs: number | null;
  domContentLoadedMs: number | null;
}

function mutableNetworkMetrics(): MutableNetworkMetrics {
  return { ...EMPTY_NETWORK_METRICS };
}

function snapshotNetworkMetrics(metrics: MutableNetworkMetrics): PhaseNetworkMetrics {
  return { ...metrics };
}

function payloadBytes(payloadData: string, opcode: number): number {
  if (opcode === 2) {
    try {
      return Buffer.from(payloadData, "base64").byteLength;
    } catch {
      return Buffer.byteLength(payloadData);
    }
  }
  return Buffer.byteLength(payloadData);
}

export function sanitizeDiagnostic(message: string): string {
  return message
    .replace(/\b(?:https?|wss?):\/\/[^\s'"<>]+/giu, (rawUrl) => {
      try {
        const url = new URL(rawUrl);
        return `${url.protocol}//${url.host}${url.pathname}${url.search || url.hash ? "?[redacted]" : ""}`;
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(
      /\b(token|secret|password|credential|authorization|cookie|session[-_]?id)\s*[:=]\s*([^\s&]+)/giu,
      "$1=[redacted]",
    );
}

function cdpMetricValue(
  response: { readonly metrics?: ReadonlyArray<{ readonly name: string; readonly value: number }> },
  name: string,
): number | null {
  const value = response.metrics?.find((metric) => metric.name === name)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readCdpRuntimeMetrics(session: CDPSession): Promise<{
  readonly taskMs: number | null;
  readonly heapBytes: number | null;
}> {
  const metrics = (await session.send("Performance.getMetrics")) as {
    readonly metrics?: ReadonlyArray<{ readonly name: string; readonly value: number }>;
  };
  const taskSeconds = cdpMetricValue(metrics, "TaskDuration");
  return {
    taskMs: taskSeconds === null ? null : taskSeconds * 1_000,
    heapBytes: cdpMetricValue(metrics, "JSHeapUsedSize"),
  };
}

function durationDelta(after: number | null, before: number | null): number | null {
  if (after === null || before === null) return null;
  return Math.max(0, after - before);
}

async function forceDocumentVisibility(page: Page, state: "hidden" | "visible"): Promise<void> {
  await page.evaluate((nextState) => {
    const setter = (
      globalThis as unknown as {
        readonly __rycoSetExternalVisibility?: (value: "hidden" | "visible") => void;
      }
    ).__rycoSetExternalVisibility;
    if (!setter) throw new Error("External visibility controller was not installed.");
    setter(nextState);
  }, state);
}

async function installPerfObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface BrowserPerformanceEntry {
      readonly name: string;
      readonly startTime: number;
      readonly duration: number;
      readonly hadRecentInput?: boolean;
      readonly value?: number;
    }
    const browserGlobal = globalThis as unknown as {
      readonly PerformanceObserver: new (
        callback: (list: { getEntries: () => BrowserPerformanceEntry[] }) => void,
      ) => { observe: (options: { type: string; buffered: boolean }) => void };
      readonly Event: new (type: string) => unknown;
      readonly document: {
        readonly hidden: boolean;
        readonly visibilityState: string;
        dispatchEvent: (event: unknown) => void;
      };
    };
    const state: BrowserPerfState = {
      fcpMs: null,
      lcpMs: null,
      cls: 0,
      longTasks: 0,
      maxLongTaskMs: 0,
    };
    Object.defineProperty(globalThis, "__rycoExternalPerf", {
      value: state,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    let forcedVisibility: "hidden" | "visible" = "visible";
    Object.defineProperty(browserGlobal.document, "hidden", {
      configurable: true,
      get: () => forcedVisibility === "hidden",
    });
    Object.defineProperty(browserGlobal.document, "visibilityState", {
      configurable: true,
      get: () => forcedVisibility,
    });
    Object.defineProperty(globalThis, "__rycoSetExternalVisibility", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: (value: "hidden" | "visible") => {
        forcedVisibility = value;
        browserGlobal.document.dispatchEvent(new browserGlobal.Event("visibilitychange"));
      },
    });
    const observe = (type: string, callback: (entries: BrowserPerformanceEntry[]) => void) => {
      try {
        const observer = new browserGlobal.PerformanceObserver((list) =>
          callback(list.getEntries()),
        );
        observer.observe({ type, buffered: true });
      } catch {
        // Unsupported entry types remain null/zero and are reported as unavailable.
      }
    };
    observe("paint", (entries) => {
      const fcp = entries.find((entry) => entry.name === "first-contentful-paint");
      if (fcp) state.fcpMs = fcp.startTime;
    });
    observe("largest-contentful-paint", (entries) => {
      const latest = entries.at(-1);
      if (latest) state.lcpMs = latest.startTime;
    });
    observe("layout-shift", (entries) => {
      for (const entry of entries) {
        if (!entry.hadRecentInput && typeof entry.value === "number") state.cls += entry.value;
      }
    });
    observe("longtask", (entries) => {
      state.longTasks += entries.length;
      for (const entry of entries)
        state.maxLongTaskMs = Math.max(state.maxLongTaskMs, entry.duration);
    });
  });
}

async function readBrowserVitals(page: Page, usableMs: number): Promise<BrowserVitals> {
  const observed = await page.evaluate(() => {
    interface BrowserNavigationTiming {
      readonly responseStart: number;
      readonly domContentLoadedEventEnd: number;
    }
    const browserGlobal = globalThis as unknown as {
      readonly __rycoExternalPerf?: BrowserPerfState;
      readonly performance: {
        getEntriesByType: (type: string) => BrowserNavigationTiming[];
      };
    };
    const state = browserGlobal.__rycoExternalPerf;
    const navigation = browserGlobal.performance.getEntriesByType("navigation")[0];
    return {
      state: state ?? null,
      navigation: navigation
        ? {
            ttfbMs: navigation.responseStart,
            domContentLoadedMs: navigation.domContentLoadedEventEnd,
          }
        : null,
    };
  });
  const navigation: NavigationTimingSnapshot = observed.navigation ?? {
    ttfbMs: null,
    domContentLoadedMs: null,
  };
  return {
    ttfbMs: navigation.ttfbMs,
    domContentLoadedMs: navigation.domContentLoadedMs,
    fcpMs: observed.state?.fcpMs ?? null,
    lcpMs: observed.state?.lcpMs ?? null,
    cls: observed.state?.cls ?? null,
    usableMs,
    longTasks: observed.state?.longTasks ?? 0,
    maxLongTaskMs: observed.state?.maxLongTaskMs ?? 0,
  };
}

export async function runBrowserProbe(input: {
  readonly browser: Browser;
  readonly entryUrl: string;
  readonly scenario: PerfScenarioConfig;
}): Promise<BrowserProbeResult> {
  const context = await input.browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const errors: string[] = [];
  const phases: Record<NetworkPhase, MutableNetworkMetrics> = {
    bootstrap: mutableNetworkMetrics(),
    foregroundIdle: mutableNetworkMetrics(),
    hiddenIdle: mutableNetworkMetrics(),
    reconnect: mutableNetworkMetrics(),
  };
  const requestPhases = new Map<string, NetworkPhase>();
  let phase: NetworkPhase = "bootstrap";
  let reconnectResolver: (() => void) | null = null;
  const activeWebSocketRef: { current: WebSocketRoute | null } = { current: null };

  await page.routeWebSocket("**", (webSocket) => {
    activeWebSocketRef.current = webSocket;
    webSocket.connectToServer();
    reconnectResolver?.();
  });

  page.on("pageerror", (error) => errors.push(`page: ${sanitizeDiagnostic(error.message)}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (phase === "reconnect" && text.includes("ERR_INTERNET_DISCONNECTED")) return;
    errors.push(`console: ${sanitizeDiagnostic(text)}`);
  });

  session.on("Network.requestWillBeSent", (event) => {
    requestPhases.set(event.requestId, phase);
    const metrics = phases[phase];
    metrics.requests += 1;
    if (event.type === "Fetch" || event.type === "XHR") metrics.fetchXhrRequests += 1;
  });
  session.on("Network.loadingFinished", (event) => {
    const requestPhase = requestPhases.get(event.requestId) ?? phase;
    phases[requestPhase].encodedBytes += Math.max(0, event.encodedDataLength);
    requestPhases.delete(event.requestId);
  });
  session.on("Network.loadingFailed", (event) => {
    const requestPhase = requestPhases.get(event.requestId) ?? phase;
    phases[requestPhase].failedRequests += event.canceled ? 0 : 1;
    requestPhases.delete(event.requestId);
  });
  session.on("Network.webSocketFrameReceived", (event) => {
    const metrics = phases[phase];
    metrics.webSocketFrames += 1;
    metrics.webSocketBytes += payloadBytes(event.response.payloadData, event.response.opcode);
  });

  await Promise.all([
    session.send("Network.enable"),
    session.send("Network.setCacheDisabled", { cacheDisabled: true }),
    session.send("Performance.enable"),
    installPerfObservers(page),
  ]);

  let reconnectMs: number | null = null;
  let foregroundTaskMs: number | null = null;
  let hiddenTaskMs: number | null = null;
  let heapBeforeIdleBytes: number | null = null;
  let heapAfterIdleBytes: number | null = null;
  let vitals: BrowserVitals = {
    ttfbMs: null,
    domContentLoadedMs: null,
    fcpMs: null,
    lcpMs: null,
    cls: null,
    usableMs: null,
    longTasks: 0,
    maxLongTaskMs: 0,
  };

  try {
    const navigationStartedAt = performance.now();
    await page.goto(input.entryUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const entryPath = new URL(input.entryUrl).pathname;
    if (entryPath === "/pair") {
      await page.waitForURL((url) => url.pathname !== "/pair", { timeout: 30_000 });
    }
    if (input.scenario.targetPath) {
      const targetUrl = new URL(input.scenario.targetPath, page.url()).toString();
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await page.locator(input.scenario.readySelector).waitFor({ state: "visible", timeout: 30_000 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          (
            globalThis as unknown as {
              requestAnimationFrame: (callback: () => void) => number;
            }
          ).requestAnimationFrame(() => resolve()),
        ),
    );
    const usableMs = performance.now() - navigationStartedAt;
    await page.waitForTimeout(750);
    vitals = await readBrowserVitals(page, usableMs);

    const beforeForeground = await readCdpRuntimeMetrics(session);
    heapBeforeIdleBytes = beforeForeground.heapBytes;
    phase = "foregroundIdle";
    await page.waitForTimeout(input.scenario.idleMs);
    const afterForeground = await readCdpRuntimeMetrics(session);
    foregroundTaskMs = durationDelta(afterForeground.taskMs, beforeForeground.taskMs);

    await forceDocumentVisibility(page, "hidden");
    const beforeHidden = await readCdpRuntimeMetrics(session);
    phase = "hiddenIdle";
    await page.waitForTimeout(input.scenario.hiddenIdleMs);
    const afterHidden = await readCdpRuntimeMetrics(session);
    hiddenTaskMs = durationDelta(afterHidden.taskMs, beforeHidden.taskMs);
    await forceDocumentVisibility(page, "visible");

    phase = "reconnect";
    await context.setOffline(true);
    if (activeWebSocketRef.current) {
      await activeWebSocketRef.current.close({
        code: 1012,
        reason: "external performance recovery probe",
      });
      activeWebSocketRef.current = null;
    } else {
      errors.push("browser: no active WebSocket was available for the recovery probe.");
    }
    await page.waitForTimeout(input.scenario.offlineMs);
    const onlineAt = performance.now();
    const reconnectPromise = new Promise<void>((resolve) => {
      reconnectResolver = resolve;
    });
    await context.setOffline(false);
    const reconnected = await Promise.race([
      reconnectPromise.then(() => true),
      page.waitForTimeout(input.scenario.reconnectTimeoutMs).then(() => false),
    ]);
    reconnectResolver = null;
    if (reconnected) reconnectMs = performance.now() - onlineAt;
    else errors.push("browser: no WebSocket reconnect handshake before the recovery deadline.");
    heapAfterIdleBytes = (await readCdpRuntimeMetrics(session)).heapBytes;
  } catch (error) {
    errors.push(
      `browser: ${sanitizeDiagnostic(error instanceof Error ? error.message : String(error))}`,
    );
  } finally {
    await context.close();
  }

  return {
    reconnectMs,
    foregroundTaskMs,
    hiddenTaskMs,
    heapBeforeIdleBytes,
    heapAfterIdleBytes,
    vitals,
    bootstrapNetwork: snapshotNetworkMetrics(phases.bootstrap),
    foregroundIdleNetwork: snapshotNetworkMetrics(phases.foregroundIdle),
    hiddenIdleNetwork: snapshotNetworkMetrics(phases.hiddenIdle),
    reconnectNetwork: snapshotNetworkMetrics(phases.reconnect),
    errors,
  };
}

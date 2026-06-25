import { scopeThreadRef } from "@ryco/client-runtime";
import type {
  BrowserCookieMetadata,
  BrowserEvent,
  BrowserSessionSnapshot,
  BrowserStorageDataType,
  BrowserStorageInspectionResult,
  BrowserTabSnapshot,
  ProjectId,
  ScopedThreadRef,
} from "@ryco/contracts";
import { normalizeBrowserNavigationUrl } from "@ryco/shared/browser";
import { useParams } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CookieIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  GlobeIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldAlertIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { readEnvironmentApi } from "../environmentApi";
import { readLocalApi } from "../localApi";
import { createThreadSelectorByRef } from "../storeSelectors";
import { useStore } from "../store";
import { resolveThreadRouteRef } from "../threadRoutes";
import { cn } from "~/lib/utils";
import {
  BROWSER_CURRENT_ORIGIN_STORAGE_TYPES,
  BROWSER_PROFILE_CLEAR_TYPES,
  formatBrowserCookieExpiry,
  formatBrowserStorageBytes,
  summarizeBrowserStorageInspection,
} from "./BrowserPanel.logic";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

const UNSUPPORTED_MESSAGE = "Built-in browser is available for the local Ryco desktop backend.";

type BrowserPanelStatus = "loading" | "unsupported" | "ready" | "error";

function resolveSelectedTab(session: BrowserSessionSnapshot | null): BrowserTabSnapshot | null {
  if (!session) return null;
  return session.tabs.find((tab) => tab.tabId === session.selectedTabId) ?? session.tabs[0] ?? null;
}

function applyBrowserEvent(
  current: BrowserSessionSnapshot | null,
  event: BrowserEvent,
): BrowserSessionSnapshot | null {
  if (!current) return current;
  if (event.type === "session.updated" && event.session.sessionId === current.sessionId) {
    return event.session;
  }
  if (event.type === "session.closed" && event.sessionId === current.sessionId) {
    return { ...current, status: "closed", updatedAt: new Date().toISOString() };
  }
  if (event.type === "tab.updated" && event.tab.sessionId === current.sessionId) {
    const tabs = current.tabs.some((tab) => tab.tabId === event.tab.tabId)
      ? current.tabs.map((tab) => (tab.tabId === event.tab.tabId ? event.tab : tab))
      : [...current.tabs, event.tab];
    return {
      ...current,
      tabs,
      selectedTabId: event.tab.selected ? event.tab.tabId : current.selectedTabId,
      updatedAt: new Date().toISOString(),
    };
  }
  if (event.type === "tab.crashed" && event.sessionId === current.sessionId) {
    return {
      ...current,
      status: "error",
      tabs: current.tabs.map((tab) =>
        tab.tabId === event.tabId ? { ...tab, crashed: true, updatedAt: event.createdAt } : tab,
      ),
      updatedAt: event.createdAt,
    };
  }
  return current;
}

function BrowserUnavailableState(props: { title: string; description: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <div className="max-w-80">
        <div className="mx-auto flex size-10 items-center justify-center rounded-md border border-border/70 bg-card/60 text-muted-foreground">
          <ShieldAlertIcon className="size-4" />
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">{props.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{props.description}</p>
      </div>
    </div>
  );
}

function storageErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useBrowserRouteTarget(): {
  threadRef: ScopedThreadRef | null;
  projectId: ProjectId | null;
} {
  const params = useParams({ strict: false }) as Record<string, string | undefined>;
  const routeThreadRef = resolveThreadRouteRef(params);
  const draftId = params.draftId ? DraftId.make(params.draftId) : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );
  const threadRef = useMemo<ScopedThreadRef | null>(() => {
    if (routeThreadRef) return routeThreadRef;
    if (!draftSession) return null;
    return scopeThreadRef(draftSession.environmentId, draftSession.threadId);
  }, [draftSession, routeThreadRef]);
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));

  return {
    threadRef,
    projectId: serverThread?.projectId ?? draftSession?.projectId ?? null,
  };
}

function BrowserStorageInspector(props: {
  inspection: BrowserStorageInspectionResult | null;
  loading: boolean;
  message: string | null;
  view: "cookies" | "storage" | "actions";
  profileClearConfirmation: "cookies" | "all" | null;
  onViewChange: (view: "cookies" | "storage" | "actions") => void;
  onRefresh: () => void;
  onClose: () => void;
  onDeleteCookie: (cookie: BrowserCookieMetadata) => void;
  onClearCurrentOriginCookies: () => void;
  onClearCurrentOriginStorage: () => void;
  onRequestProfileClear: (action: "cookies" | "all") => void;
  onCancelProfileClear: () => void;
  onConfirmProfileClear: (action: "cookies" | "all") => void;
}) {
  const summary = summarizeBrowserStorageInspection(props.inspection);
  const originLabel = props.inspection?.origin ?? "No origin";
  const hasInspection = props.inspection !== null;
  const currentOriginDisabled = !props.inspection?.origin || props.loading;
  const profileDisabled = !hasInspection || props.loading;
  const storageSections = [
    { label: "localStorage", entries: props.inspection?.localStorage ?? [] },
    { label: "sessionStorage", entries: props.inspection?.sessionStorage ?? [] },
  ];

  return (
    <div className="flex h-72 shrink-0 flex-col border-b border-border/70 bg-card/30">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/50 px-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
          <DatabaseIcon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-xs font-medium text-foreground">Storage</p>
            <Badge size="sm" variant="outline">
              {summary.profileCookies} cookies
            </Badge>
            <Badge size="sm" variant="outline">
              {formatBrowserStorageBytes(summary.storageBytes)}
            </Badge>
          </div>
          <p className="truncate text-[0.6875rem] text-muted-foreground">{originLabel}</p>
        </div>
        <Button
          aria-label="Refresh storage"
          disabled={props.loading}
          size="icon-xs"
          variant="ghost"
          onClick={props.onRefresh}
        >
          <RefreshCwIcon className={cn("size-3.5", props.loading && "animate-spin")} />
        </Button>
        <Button aria-label="Close storage" size="icon-xs" variant="ghost" onClick={props.onClose}>
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {props.message ? (
        <Alert className="m-2 shrink-0 rounded-md py-2" variant="error">
          <AlertTitle>Storage command failed</AlertTitle>
          <AlertDescription>{props.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        {(["cookies", "storage", "actions"] as const).map((view) => (
          <Button
            key={view}
            className="flex-1"
            size="xs"
            variant={props.view === view ? "secondary" : "ghost"}
            onClick={() => props.onViewChange(view)}
          >
            {view === "cookies" ? <CookieIcon className="size-3.5" /> : null}
            {view === "storage" ? <DatabaseIcon className="size-3.5" /> : null}
            {view === "actions" ? <Trash2Icon className="size-3.5" /> : null}
            {view === "cookies" ? "Cookies" : view === "storage" ? "Storage" : "Actions"}
          </Button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {!hasInspection && props.loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <Loader2Icon className="mr-2 size-3.5 animate-spin" />
            Loading storage
          </div>
        ) : props.view === "cookies" ? (
          <ScrollArea className="h-full" scrollbarGutter>
            <div className="space-y-1.5 p-2">
              {props.inspection?.cookies.length ? (
                props.inspection.cookies.map((cookie) => (
                  <div
                    key={`${cookie.domain}:${cookie.path}:${cookie.name}:${cookie.secure}`}
                    className="flex min-w-0 items-start gap-2 rounded-md border border-border/60 bg-background/60 p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="min-w-0 truncate text-xs font-medium text-foreground">
                          {cookie.name}
                        </p>
                        {cookie.httpOnly ? (
                          <Badge size="sm" variant="outline">
                            HttpOnly
                          </Badge>
                        ) : null}
                        {cookie.secure ? (
                          <Badge size="sm" variant="outline">
                            Secure
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-[0.6875rem] text-muted-foreground">
                        {cookie.domain || props.inspection?.origin} {cookie.path}
                      </p>
                      <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                        {formatBrowserCookieExpiry(cookie)} ·{" "}
                        {formatBrowserStorageBytes(cookie.sizeBytes)}
                      </p>
                    </div>
                    <Button
                      aria-label={`Delete cookie ${cookie.name}`}
                      disabled={props.loading}
                      size="icon-xs"
                      variant="destructive-outline"
                      onClick={() => props.onDeleteCookie(cookie)}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                ))
              ) : (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  No cookies for this origin.
                </p>
              )}
            </div>
          </ScrollArea>
        ) : props.view === "storage" ? (
          <ScrollArea className="h-full" scrollbarGutter>
            <div className="space-y-3 p-2">
              {storageSections.map(({ label, entries }) => (
                <div key={label} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <p className="text-[0.6875rem] font-medium text-muted-foreground">{label}</p>
                    <Badge size="sm" variant="outline">
                      {entries.length}
                    </Badge>
                  </div>
                  {entries.length ? (
                    entries.map((entry) => (
                      <div
                        key={`${label}:${entry.key}`}
                        className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
                      >
                        <p className="min-w-0 truncate text-xs text-foreground">{entry.key}</p>
                        <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                          {formatBrowserStorageBytes(entry.valueBytes)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-md border border-dashed border-border/70 px-2 py-3 text-center text-xs text-muted-foreground">
                      Empty
                    </p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <ScrollArea className="h-full" scrollbarGutter>
            <div className="space-y-2 p-2">
              <Button
                className="w-full justify-start"
                disabled={currentOriginDisabled}
                size="xs"
                variant="outline"
                onClick={props.onClearCurrentOriginCookies}
              >
                <CookieIcon className="size-3.5" />
                Clear origin cookies
              </Button>
              <Button
                className="w-full justify-start"
                disabled={currentOriginDisabled}
                size="xs"
                variant="outline"
                onClick={props.onClearCurrentOriginStorage}
              >
                <DatabaseIcon className="size-3.5" />
                Clear origin storage
              </Button>

              <div className="border-t border-border/60 pt-2">
                {props.profileClearConfirmation === "cookies" ? (
                  <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                    <p className="text-xs font-medium text-destructive-foreground">
                      Clear all profile cookies?
                    </p>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        disabled={props.loading}
                        size="xs"
                        variant="destructive"
                        onClick={() => props.onConfirmProfileClear("cookies")}
                      >
                        Confirm
                      </Button>
                      <Button
                        className="flex-1"
                        disabled={props.loading}
                        size="xs"
                        variant="ghost"
                        onClick={props.onCancelProfileClear}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="w-full justify-start"
                    disabled={profileDisabled}
                    size="xs"
                    variant="destructive-outline"
                    onClick={() => props.onRequestProfileClear("cookies")}
                  >
                    <CookieIcon className="size-3.5" />
                    Clear profile cookies
                  </Button>
                )}
              </div>

              <div>
                {props.profileClearConfirmation === "all" ? (
                  <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                    <p className="text-xs font-medium text-destructive-foreground">
                      Clear all profile data and cache?
                    </p>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        disabled={props.loading}
                        size="xs"
                        variant="destructive"
                        onClick={() => props.onConfirmProfileClear("all")}
                      >
                        Confirm
                      </Button>
                      <Button
                        className="flex-1"
                        disabled={props.loading}
                        size="xs"
                        variant="ghost"
                        onClick={props.onCancelProfileClear}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="w-full justify-start"
                    disabled={profileDisabled}
                    size="xs"
                    variant="destructive-outline"
                    onClick={() => props.onRequestProfileClear("all")}
                  >
                    <Trash2Icon className="size-3.5" />
                    Clear profile data/cache
                  </Button>
                )}
              </div>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

export default function BrowserPanel() {
  const { threadRef, projectId } = useBrowserRouteTarget();
  const [status, setStatus] = useState<BrowserPanelStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<BrowserSessionSnapshot | null>(null);
  const [addressValue, setAddressValue] = useState("");
  const [isNavigating, setIsNavigating] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageView, setStorageView] = useState<"cookies" | "storage" | "actions">("cookies");
  const [storageInspection, setStorageInspection] = useState<BrowserStorageInspectionResult | null>(
    null,
  );
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [profileClearConfirmation, setProfileClearConfirmation] = useState<
    "cookies" | "all" | null
  >(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const addressFocusedRef = useRef(false);

  const api = threadRef ? readEnvironmentApi(threadRef.environmentId) : undefined;
  const browserApi = api?.browser;
  const selectedTab = resolveSelectedTab(session);
  const sessionId = session?.sessionId ?? null;
  const selectedTabId = selectedTab?.tabId ?? null;
  const navigation = selectedTab?.navigation ?? null;
  const nativeBridge = typeof window === "undefined" ? undefined : window.desktopBridge?.browser;
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;

  useEffect(() => {
    if (!addressFocusedRef.current) {
      setAddressValue(navigation?.url ?? "");
    }
  }, [navigation?.url]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const openSession = async () => {
      setSession(null);
      setMessage(null);
      setStorageInspection(null);
      setStorageMessage(null);
      setProfileClearConfirmation(null);

      if (!environmentId || !threadId) {
        setStatus("unsupported");
        setMessage("No active thread is available for this browser session.");
        return;
      }
      const currentBrowserApi = readEnvironmentApi(environmentId)?.browser;
      const currentNativeBridge =
        typeof window === "undefined" ? undefined : window.desktopBridge?.browser;
      if (!currentBrowserApi || !currentNativeBridge) {
        setStatus("unsupported");
        setMessage(UNSUPPORTED_MESSAGE);
        return;
      }

      setStatus("loading");

      try {
        unsubscribe = currentBrowserApi.onEvent((event) => {
          if (event.type === "host.disconnected") {
            setStatus("unsupported");
            setMessage("The desktop BrowserHost disconnected.");
          }
          setSession((current) => applyBrowserEvent(current, event));
        });

        const browserStatus = await currentBrowserApi.getStatus();
        if (cancelled) return;
        if (!browserStatus.supported || !browserStatus.host?.connected) {
          setStatus("unsupported");
          setMessage(UNSUPPORTED_MESSAGE);
          return;
        }

        const snapshot = await currentBrowserApi.openSession({
          threadId,
          ...(projectId ? { projectId } : {}),
          profileMode: "project",
        });
        if (cancelled) return;
        setSession(snapshot);
        setStatus("ready");
        setMessage(null);
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : String(error));
      }
    };

    void openSession();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [environmentId, projectId, threadId]);

  useEffect(() => {
    if (!nativeBridge || !selectedTabId || !sessionId || status !== "ready") {
      return;
    }

    const node = surfaceRef.current;
    if (!node) return;

    let cancelled = false;
    let attached = false;
    const surfaceTarget = {
      sessionId,
      tabId: selectedTabId,
    };

    const readBounds = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (
        !Number.isFinite(rect.x) ||
        !Number.isFinite(rect.y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return null;
      }

      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width,
        height,
        deviceScaleFactor: window.devicePixelRatio || 1,
      };
    };

    const syncBounds = () => {
      if (cancelled) return;
      const bounds = readBounds();
      if (!bounds) return;

      if (!attached) {
        attached = true;
        void nativeBridge.attachSurface({ ...surfaceTarget, bounds }).catch(() => {
          attached = false;
        });
        return;
      }

      void nativeBridge.updateSurfaceBounds({ ...surfaceTarget, bounds }).catch(() => undefined);
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            syncBounds();
          });
    resizeObserver?.observe(node);
    window.addEventListener("resize", syncBounds);
    const frame = window.requestAnimationFrame(syncBounds);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncBounds);
      resizeObserver?.disconnect();
      void nativeBridge.detachSurface(surfaceTarget).catch(() => undefined);
    };
  }, [nativeBridge, selectedTabId, sessionId, status]);

  const runControl = useCallback(
    async (action: "back" | "forward" | "reload" | "stop") => {
      if (!browserApi || !session || !selectedTab) return;
      setMessage(null);
      try {
        const snapshot = await browserApi[action]({
          sessionId: session.sessionId,
          tabId: selectedTab.tabId,
        });
        setSession(snapshot);
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [browserApi, selectedTab, session],
  );

  const navigate = useCallback(async () => {
    if (!browserApi || !session || !selectedTab) return;
    const normalized = normalizeBrowserNavigationUrl(addressValue);
    if (!normalized.ok) {
      setStatus("error");
      setMessage(normalized.message);
      return;
    }

    setIsNavigating(true);
    setMessage(null);
    try {
      const snapshot = await browserApi.navigate({
        sessionId: session.sessionId,
        tabId: selectedTab.tabId,
        url: normalized.value.url,
      });
      setSession(snapshot);
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsNavigating(false);
    }
  }, [addressValue, browserApi, selectedTab, session]);

  const loadStorageInspection = useCallback(async () => {
    if (!browserApi || !sessionId || !selectedTabId) return;
    setStorageLoading(true);
    setStorageMessage(null);
    try {
      const inspection = await browserApi.inspectStorage({
        sessionId,
        tabId: selectedTabId,
      });
      setStorageInspection(inspection);
      setSession(inspection.session);
    } catch (error) {
      setStorageMessage(storageErrorMessage(error));
    } finally {
      setStorageLoading(false);
    }
  }, [browserApi, selectedTabId, sessionId]);

  useEffect(() => {
    if (!storageOpen) return;
    void loadStorageInspection();
  }, [loadStorageInspection, navigation?.url, storageOpen]);

  const runStorageMutation = useCallback(
    async (
      operation: () => Promise<{ readonly session: BrowserSessionSnapshot }>,
    ): Promise<void> => {
      if (!browserApi || !sessionId || !selectedTabId) return;
      setStorageLoading(true);
      setStorageMessage(null);
      try {
        const result = await operation();
        setSession(result.session);
        const inspection = await browserApi.inspectStorage({
          sessionId,
          tabId: selectedTabId,
        });
        setStorageInspection(inspection);
        setSession(inspection.session);
      } catch (error) {
        setStorageMessage(storageErrorMessage(error));
      } finally {
        setStorageLoading(false);
      }
    },
    [browserApi, selectedTabId, sessionId],
  );

  const clearStorage = useCallback(
    async (
      scope: "current_origin" | "profile",
      dataTypes: ReadonlyArray<BrowserStorageDataType>,
    ) => {
      if (!browserApi || !sessionId || !selectedTabId) return;
      await runStorageMutation(() =>
        browserApi.clearStorage({
          sessionId,
          tabId: selectedTabId,
          scope,
          dataTypes: [...dataTypes],
        }),
      );
    },
    [browserApi, runStorageMutation, selectedTabId, sessionId],
  );

  const deleteCookie = useCallback(
    async (cookie: BrowserCookieMetadata) => {
      if (!browserApi || !sessionId || !selectedTabId) return;
      await runStorageMutation(() =>
        browserApi.deleteCookie({
          sessionId,
          tabId: selectedTabId,
          url: navigation?.url,
          name: cookie.name,
          ...(cookie.domain ? { domain: cookie.domain } : {}),
          ...(cookie.path ? { path: cookie.path } : {}),
          secure: cookie.secure,
        }),
      );
    },
    [browserApi, navigation?.url, runStorageMutation, selectedTabId, sessionId],
  );

  const openExternal = useCallback(() => {
    if (!navigation?.url) return;
    const localApi = readLocalApi();
    void localApi?.shell.openExternal(navigation.url).catch((error: unknown) => {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : String(error));
    });
  }, [navigation?.url]);

  const focusSurface = useCallback(() => {
    if (!nativeBridge || !session || !selectedTab) return;
    void nativeBridge
      .focusSurface({ sessionId: session.sessionId, tabId: selectedTab.tabId })
      .catch(() => undefined);
  }, [nativeBridge, selectedTab, session]);

  if (status === "unsupported") {
    return (
      <BrowserUnavailableState
        title="Browser unavailable"
        description={message ?? UNSUPPORTED_MESSAGE}
      />
    );
  }

  const loading = status === "loading";
  const crashed = selectedTab?.crashed === true || session?.status === "error";
  const loadState = navigation?.loadState ?? "idle";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <form
        className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border/70 bg-card/35 px-2"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate();
        }}
      >
        <Button
          aria-label="Back"
          disabled={!navigation?.canGoBack || loading}
          size="icon-xs"
          variant="ghost"
          onClick={() => void runControl("back")}
        >
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <Button
          aria-label="Forward"
          disabled={!navigation?.canGoForward || loading}
          size="icon-xs"
          variant="ghost"
          onClick={() => void runControl("forward")}
        >
          <ArrowRightIcon className="size-3.5" />
        </Button>
        {loadState === "loading" || isNavigating ? (
          <Button
            aria-label="Stop loading"
            disabled={!selectedTab || loading}
            size="icon-xs"
            variant="ghost"
            onClick={() => void runControl("stop")}
          >
            <SquareIcon className="size-3.5" />
          </Button>
        ) : (
          <Button
            aria-label="Reload"
            disabled={!selectedTab || loading}
            size="icon-xs"
            variant="ghost"
            onClick={() => void runControl("reload")}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        )}
        <Input
          aria-label="Browser address"
          className="min-w-0 flex-1"
          disabled={!selectedTab || loading}
          nativeInput
          onBlur={() => {
            addressFocusedRef.current = false;
            setAddressValue(navigation?.url ?? "");
          }}
          onChange={(event) => setAddressValue(event.currentTarget.value)}
          onFocus={() => {
            addressFocusedRef.current = true;
          }}
          placeholder="https://localhost:3000"
          size="sm"
          type="text"
          value={addressValue}
        />
        <Button
          aria-label="Navigate"
          disabled={!selectedTab || loading || isNavigating}
          size="xs"
          type="submit"
          variant="secondary"
        >
          {isNavigating ? <Loader2Icon className="size-3.5 animate-spin" /> : <GlobeIcon />}
          Go
        </Button>
        <Button
          aria-label="Open externally"
          disabled={!navigation?.url}
          size="icon-xs"
          variant="ghost"
          onClick={openExternal}
        >
          <ExternalLinkIcon className="size-3.5" />
        </Button>
        <Button
          aria-label="Manage browser storage"
          disabled={!selectedTab || loading}
          size="icon-xs"
          variant={storageOpen ? "secondary" : "ghost"}
          onClick={() => setStorageOpen((open) => !open)}
        >
          <DatabaseIcon className="size-3.5" />
        </Button>
      </form>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/50 px-3 text-xs text-muted-foreground">
          <Badge
            className={cn(
              "max-w-[60%] justify-start truncate",
              crashed && "border-destructive/32 text-destructive-foreground",
            )}
            size="sm"
            variant={crashed ? "error" : "outline"}
          >
            {crashed ? "Crashed" : session?.profileId ? "Project profile" : "Opening"}
          </Badge>
          <span className="min-w-0 flex-1 truncate">{navigation?.origin ?? navigation?.url}</span>
          {loadState === "loading" || loading ? (
            <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground/80" />
          ) : null}
        </div>

        {message && status === "error" ? (
          <Alert className="m-3 shrink-0 rounded-lg" variant="error">
            <AlertTitle>Browser command failed</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        {storageOpen ? (
          <BrowserStorageInspector
            inspection={storageInspection}
            loading={storageLoading}
            message={storageMessage}
            profileClearConfirmation={profileClearConfirmation}
            view={storageView}
            onCancelProfileClear={() => setProfileClearConfirmation(null)}
            onClearCurrentOriginCookies={() => void clearStorage("current_origin", ["cookies"])}
            onClearCurrentOriginStorage={() =>
              void clearStorage("current_origin", BROWSER_CURRENT_ORIGIN_STORAGE_TYPES)
            }
            onClose={() => {
              setStorageOpen(false);
              setProfileClearConfirmation(null);
            }}
            onConfirmProfileClear={(action) => {
              setProfileClearConfirmation(null);
              void clearStorage(
                "profile",
                action === "cookies" ? ["cookies"] : BROWSER_PROFILE_CLEAR_TYPES,
              );
            }}
            onDeleteCookie={(cookie) => void deleteCookie(cookie)}
            onRefresh={() => void loadStorageInspection()}
            onRequestProfileClear={(action) => setProfileClearConfirmation(action)}
            onViewChange={setStorageView}
          />
        ) : null}

        <div
          ref={surfaceRef}
          className="relative min-h-0 flex-1 bg-muted/25"
          onMouseDown={focusSurface}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              Connecting to BrowserHost
            </div>
          ) : selectedTab ? null : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              No browser tab is active.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

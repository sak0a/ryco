import {
  CheckIcon,
  Loader2Icon,
  LogOutIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { NativeHandoffPresentation } from "@ryco/contracts/native-handoff";

import { APP_DISPLAY_NAME } from "../../branding";
import { hostedHubApi, HostedHubApiError } from "../../hostedHub/api";
import { hostedHubController, useHostedHubStore } from "../../hostedHub/state";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

const HostedAuthenticationSurface = lazy(() =>
  import("./HostedHubRoot").then((module) => ({
    default: module.HostedAuthenticationSurface,
  })),
);

type ConsentAction = "approve" | "cancel" | "switch-account";

function navigateToNativeCallback(redirectUri: string): void {
  window.location.assign(redirectUri);
}

export function HostedNativeAuthorizationRoute({
  handoffId,
  navigate = navigateToNativeCallback,
}: {
  readonly handoffId: string;
  readonly navigate?: (redirectUri: string) => void;
}) {
  const accountStatus = useHostedHubStore((state) => state.accountStatus);
  const account = useHostedHubStore((state) => state.account);
  const [presentation, setPresentation] = useState<NativeHandoffPresentation | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<ConsentAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const operation = new AbortController();
    setLoading(true);
    setError(null);
    void hostedHubApi
      .getNativeHandoffPresentation(handoffId, operation.signal)
      .then((next) => setPresentation(next))
      .catch((cause: unknown) => {
        if (operation.signal.aborted) return;
        setError(
          cause instanceof HostedHubApiError
            ? cause.message
            : "This device authorization is unavailable or has expired.",
        );
      })
      .finally(() => {
        if (!operation.signal.aborted) setLoading(false);
      });
    return () => operation.abort();
  }, [handoffId]);

  useEffect(() => {
    if (!loading && accountStatus === "authenticated") {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [accountStatus, loading]);

  if (accountStatus !== "authenticated" || !account) {
    return (
      <Suspense fallback={null}>
        <HostedAuthenticationSurface
          context="native-authorization"
          autoExternalProvider={presentation?.providerHint ?? null}
        />
      </Suspense>
    );
  }

  const run = async (nextAction: ConsentAction) => {
    if (action !== null) return;
    setAction(nextAction);
    setError(null);
    try {
      if (nextAction === "switch-account") {
        await hostedHubController.signOut();
        return;
      }
      const result =
        nextAction === "approve"
          ? await hostedHubApi.approveNativeHandoff(handoffId)
          : await hostedHubApi.cancelNativeHandoff(handoffId);
      navigate(result.redirectUri);
    } catch (cause) {
      setError(
        cause instanceof HostedHubApiError
          ? cause.message
          : "The device authorization could not be completed.",
      );
    } finally {
      setAction(null);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-x-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="w-full max-w-md rounded-[1.5rem] border border-border bg-card p-5 shadow-2xl shadow-black/10 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-primary">
            <ShieldCheckIcon aria-hidden className="size-5" />
          </div>
          <p className="pt-1 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {APP_DISPLAY_NAME} Hub
          </p>
        </div>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-6 text-2xl font-semibold tracking-tight outline-none"
        >
          Continue on this device?
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Only continue if you started this connection from the Ryco app. The app receives a
          one-time code, never this browser session.
        </p>

        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-background/65">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
            <SmartphoneIcon aria-hidden className="size-5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Requesting device</p>
              <p className="truncate text-sm font-medium">
                {loading ? "Checking request…" : (presentation?.deviceLabel ?? "Unknown device")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary"
            >
              {account.displayName.trim().slice(0, 1).toLocaleUpperCase() || "R"}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <p className="truncate text-sm font-medium">{account.displayName}</p>
            </div>
          </div>
        </div>

        {error ? (
          <Alert variant="error" className="mt-4">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>Authorization did not complete</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-6 space-y-2.5">
          <Button
            size="lg"
            className="min-h-11 w-full"
            disabled={loading || !presentation || action !== null}
            onClick={() => void run("approve")}
          >
            {action === "approve" ? (
              <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
            ) : (
              <CheckIcon aria-hidden />
            )}
            Continue as {account.displayName}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="min-h-11 w-full"
            disabled={action !== null}
            onClick={() => void run("switch-account")}
          >
            {action === "switch-account" ? (
              <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
            ) : (
              <LogOutIcon aria-hidden />
            )}
            Use another account
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="min-h-11 w-full"
            disabled={loading || !presentation || action !== null}
            onClick={() => void run("cancel")}
          >
            {action === "cancel" ? (
              <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
            ) : (
              <XIcon aria-hidden />
            )}
            Cancel
          </Button>
        </div>

        <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
          Access remains limited to the nodes and permissions assigned to this Hub account.
        </p>
      </section>
    </main>
  );
}

import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  KeyRoundIcon,
  LogOutIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";

import { RootAppShell } from "../RootAppShell";
import { Button } from "../ui/button";
import { APP_DISPLAY_NAME } from "../../branding";
import {
  HOSTED_SESSION_SYNC_FAILURE_MESSAGE,
  hostedHubController,
  useHostedHubStore,
} from "../../hostedHub/state";
import {
  selectHostedNodeRoute,
  useHostedNodeRouteNotice,
  useHostedNodeRouteOrchestrator,
  useRoutedHostedNode,
} from "../../hostedHub/nodeRouteOrchestrator";
import type { HostedHubNode } from "../../hostedHub/types";
import { HostedNodeEnrollmentFlow } from "./HostedNodeEnrollment";
import { HostedPwaControls } from "./HostedPwaControls";
import { HostedRelayTrustNotice } from "./HostedRelayTrustNotice";

export function HostedHubRoot() {
  const accountStatus = useHostedHubStore((state) => state.accountStatus);
  const selectedNode = useHostedHubStore((state) => state.selectedNode);
  const recoveryCodes = useHostedHubStore((state) => state.recoveryCodes);
  const transportStatus = useHostedHubStore((state) => state.transportStatus);
  const sessionEstablished = useHostedHubStore((state) => state.sessionEstablished);
  const errorMessage = useHostedHubStore((state) => state.errorMessage);
  const routedNode = useRoutedHostedNode();
  useHostedNodeRouteOrchestrator();

  useEffect(() => {
    if (accountStatus !== "authenticated") return;
    const resumeIfVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void hostedHubController.resumeBrowser();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hostedHubController.suspendBrowser("hidden");
      else resumeIfVisible();
    };
    const onOffline = () => hostedHubController.suspendBrowser("offline");
    const onOnline = () => resumeIfVisible();
    const onPageShow = () => resumeIfVisible();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    if (!navigator.onLine) onOffline();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [accountStatus]);

  if (accountStatus !== "authenticated") return <HostedAuthenticationSurface />;
  if (recoveryCodes.length > 0) return <RecoveryCodesSurface />;
  if (!selectedNode) {
    // A routed node segment is pending fail-closed validation: keep the UI on
    // a read-only restoring surface instead of flashing the directory. The
    // orchestrator either selects the node or clears the segment.
    if (routedNode.nodeId !== null) return <HostedNodeRestoringSurface />;
    return <HostedNodeDirectory />;
  }
  if (transportStatus === "terminal-failure") {
    return (
      <>
        <HostedNodeFailureSurface node={selectedNode} message={errorMessage} />
        <HostedNodeMenu />
      </>
    );
  }
  if (!sessionEstablished) {
    return <HostedNodeStartingSurface node={selectedNode} />;
  }

  return (
    <>
      <RootAppShell authGateState={{ status: "hosted-hub" }} />
      <HostedNodeMenu />
    </>
  );
}

function HostedNodeFailureSurface({
  node,
  message,
}: {
  readonly node: HostedHubNode;
  readonly message: string | null;
}) {
  return (
    <Surface>
      <AlertTriangleIcon aria-hidden className="size-8 text-destructive" />
      <h1 className="mt-4 text-2xl font-semibold">Unable to connect to {node.label}</h1>
      <p role="alert" className="mt-2 text-sm text-muted-foreground">
        {message ?? "The relay session could not be established. Choose another node or retry."}
      </p>
      {message === HOSTED_SESSION_SYNC_FAILURE_MESSAGE ? (
        <Button className="mt-5" onClick={() => void hostedHubController.retrySelectedNode()}>
          <RefreshCwIcon aria-hidden /> Retry
        </Button>
      ) : null}
    </Surface>
  );
}

function HostedNodeRestoringSurface() {
  return (
    <Surface>
      <ServerIcon aria-hidden className="size-8 text-primary" />
      <h1 className="mt-4 text-2xl font-semibold">Restoring your node</h1>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        Checking your access before reconnecting…
      </p>
    </Surface>
  );
}

function HostedNodeStartingSurface({ node }: { readonly node: HostedHubNode }) {
  return (
    <Surface>
      <ServerIcon aria-hidden className="size-8 text-primary" />
      <h1 className="mt-4 text-2xl font-semibold">Connecting to {node.label}</h1>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        Preparing a private relay session and synchronizing Ryco state…
      </p>
    </Surface>
  );
}

function Surface({ children }: { readonly children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-lg shadow-black/5 sm:p-8">
        {children}
      </section>
    </main>
  );
}

function HostedAuthenticationSurface() {
  const status = useHostedHubStore((state) => state.accountStatus);
  const error = useHostedHubStore((state) => state.errorMessage);
  const bootstrapAvailable = useHostedHubStore((state) => state.bootstrapAvailable);
  const [registrationMode, setRegistrationMode] = useState<"invitation" | "bootstrap" | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const registrationInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (registrationMode) registrationInputRef.current?.focus();
    else headingRef.current?.focus();
  }, [registrationMode]);

  return (
    <Surface>
      <div className="mb-6 flex size-11 items-center justify-center rounded-xl border border-border bg-background text-primary">
        <ShieldCheckIcon aria-hidden className="size-5" />
      </div>
      <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
        {APP_DISPLAY_NAME} Hub
      </p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-2 text-2xl font-semibold outline-none">
        {status === "session-expired" ? "Your session expired" : "Connect to your Ryco nodes"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Sign in with the passkey registered for this Hub. Your session stays in a secure, HttpOnly
        cookie.
      </p>
      <div className="mt-4">
        <HostedRelayTrustNotice />
      </div>
      <HostedPwaControls />
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}
      {registrationMode ? (
        <RegistrationForm
          mode={registrationMode}
          credentialRef={registrationInputRef}
          onBack={() => setRegistrationMode(null)}
        />
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          <Button
            size="lg"
            disabled={status === "authenticating" || status === "signing-out"}
            onClick={() => void hostedHubController.signIn()}
          >
            <KeyRoundIcon aria-hidden />
            {status === "authenticating" ? "Waiting for passkey…" : "Sign in with passkey"}
          </Button>
          {status === "authenticating" ? (
            <Button
              variant="outline"
              size="lg"
              onClick={() => hostedHubController.cancelAuthentication()}
            >
              Cancel
            </Button>
          ) : (
            <>
              <Button variant="outline" size="lg" onClick={() => setRegistrationMode("invitation")}>
                Redeem invitation
              </Button>
              {bootstrapAvailable ? (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setRegistrationMode("bootstrap")}
                >
                  Set up first owner
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}
      {status === "unavailable" ? (
        <Button
          className="mt-3"
          variant="ghost"
          onClick={() => void hostedHubController.bootstrap()}
        >
          <RefreshCwIcon aria-hidden /> Retry Hub
        </Button>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {status === "authenticating" ? "Passkey authentication is in progress." : ""}
      </p>
    </Surface>
  );
}

function RegistrationForm({
  mode,
  credentialRef,
  onBack,
}: {
  readonly mode: "invitation" | "bootstrap";
  readonly credentialRef: RefObject<HTMLInputElement | null>;
  readonly onBack: () => void;
}) {
  const status = useHostedHubStore((state) => state.accountStatus);
  const [credential, setCredential] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [passkeyLabel, setPasskeyLabel] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const registrationCredential = credential;
    setCredential("");
    const registrationInput = {
      displayName: displayName.trim(),
      passkeyLabel: passkeyLabel.trim() || null,
    };
    if (mode === "invitation") {
      await hostedHubController.redeemInvitation({
        secret: registrationCredential,
        ...registrationInput,
      });
    } else {
      await hostedHubController.bootstrapOwner({
        credential: registrationCredential,
        ...registrationInput,
      });
    }
  };

  return (
    <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)} autoComplete="off">
      <div>
        <label htmlFor="hub-registration-credential" className="text-sm font-medium">
          {mode === "invitation" ? "Invitation code" : "Bootstrap credential"}
        </label>
        <input
          ref={credentialRef}
          id="hub-registration-credential"
          type="password"
          required
          maxLength={128}
          value={credential}
          onChange={(event) => setCredential(event.currentTarget.value)}
          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="hub-display-name" className="text-sm font-medium">
          Display name
        </label>
        <input
          id="hub-display-name"
          required
          maxLength={200}
          value={displayName}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="hub-passkey-label" className="text-sm font-medium">
          Passkey label <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="hub-passkey-label"
          maxLength={100}
          value={passkeyLabel}
          onChange={(event) => setPasskeyLabel(event.currentTarget.value)}
          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={status === "authenticating"}>
          {mode === "invitation" ? "Create account and passkey" : "Create owner and passkey"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={
            status === "authenticating" ? () => hostedHubController.cancelAuthentication() : onBack
          }
        >
          {status === "authenticating" ? "Cancel" : "Back"}
        </Button>
      </div>
    </form>
  );
}

function RecoveryCodesSurface() {
  const recoveryCodes = useHostedHubStore((state) => state.recoveryCodes);
  return (
    <Surface>
      <ShieldCheckIcon aria-hidden className="size-8 text-primary" />
      <h1 className="mt-4 text-2xl font-semibold">Save your recovery codes</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        These codes are shown once. Ryco does not save them in browser storage.
      </p>
      <ul
        aria-label="Recovery codes"
        className="mt-5 grid gap-2 rounded-xl border border-border bg-background p-4 font-mono text-sm sm:grid-cols-2"
      >
        {recoveryCodes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button className="mt-5" onClick={() => hostedHubController.dismissRecoveryCodes()}>
        I saved the codes
      </Button>
    </Surface>
  );
}

function HostedNodeDirectory() {
  const nodes = useHostedHubStore((state) => state.nodes);
  const status = useHostedHubStore((state) => state.directoryStatus);
  const browserStatus = useHostedHubStore((state) => state.browserStatus);
  const error = useHostedHubStore((state) => state.errorMessage);
  const account = useHostedHubStore((state) => state.account);
  const selection = useHostedHubStore((state) => state.selectionStatus);
  const routeNotice = useHostedNodeRouteNotice();
  const navigate = useNavigate();
  const [enrolling, setEnrolling] = useState(false);

  if (enrolling) {
    return (
      <Surface>
        <HostedNodeEnrollmentFlow onClose={() => setEnrolling(false)} />
      </Surface>
    );
  }

  const select = async (node: HostedHubNode) => {
    // With the hosted node history installed, selection navigates into the
    // node-scoped route and the route orchestrator drives `selectNode`.
    if (selectHostedNodeRoute(node.id)) return;
    await navigate({ to: "/", replace: true });
    await hostedHubController.selectNode(node.id);
  };

  return (
    <Surface>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Authorized nodes
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Choose a Ryco node</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {account?.displayName ?? "Hub account"}.
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Sign out"
          onClick={() => void hostedHubController.signOut()}
        >
          <LogOutIcon aria-hidden />
        </Button>
      </div>
      {status === "stale" ? (
        <p
          role="status"
          className="mt-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"
        >
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" /> Directory data is
          stale. Actions are disabled until it refreshes.
        </p>
      ) : null}
      {selection === "authorization-removed" ||
      selection === "revoked" ||
      selection === "incompatible" ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {selection === "authorization-removed"
            ? "Authorization for the previous node was removed."
            : selection === "revoked"
              ? "The previous node or grant was revoked."
              : "The previous node uses an incompatible relay version."}
        </p>
      ) : null}
      {routeNotice ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {routeNotice}
        </p>
      ) : null}
      {error && status !== "stale" ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-5 space-y-2" aria-busy={status === "loading"}>
        {nodes.map((node) => (
          <button
            key={`${node.id}:${node.environmentId}`}
            type="button"
            disabled={status !== "ready" || browserStatus !== "current" || node.revokedAt !== null}
            onClick={() => void select(node)}
            className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <ServerIcon aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{node.label}</span>
              <span className="block text-xs text-muted-foreground">
                {node.platformOs} · {node.effectiveRole}
              </span>
            </span>
            <NodePresence node={node} />
          </button>
        ))}
        {status === "loading" ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            Loading authorized nodes…
          </p>
        ) : null}
        {status === "ready" && nodes.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No nodes are authorized for this account.
          </p>
        ) : null}
      </div>
      <div className="mt-5">
        <HostedRelayTrustNotice />
      </div>
      <HostedPwaControls />
      <Button
        className="mt-5"
        variant="outline"
        disabled={status === "loading"}
        onClick={() => void hostedHubController.refreshDirectory()}
      >
        <RefreshCwIcon aria-hidden /> Refresh nodes
      </Button>
      {account?.role === "owner" ? (
        <Button className="mt-3" onClick={() => setEnrolling(true)}>
          <ServerIcon aria-hidden /> Enroll node
        </Button>
      ) : null}
    </Surface>
  );
}

function NodePresence({ node }: { readonly node: HostedHubNode }) {
  if (node.revokedAt) return <span className="text-xs text-destructive">Revoked</span>;
  return node.presence.online ? (
    <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
      <WifiIcon aria-hidden className="size-3.5" /> Online
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <WifiOffIcon aria-hidden className="size-3.5" /> Offline
    </span>
  );
}

export function HostedNodeMenu() {
  const node = useHostedHubStore((state) => state.selectedNode);
  const nodes = useHostedHubStore((state) => state.nodes);
  const transport = useHostedHubStore((state) => state.transportStatus);
  const session = useHostedHubStore((state) => state.sessionStatus);
  const recoveredAfterUnknown = useHostedHubStore((state) => state.sessionRecoveredAfterUnknown);
  const selection = useHostedHubStore((state) => state.selectionStatus);
  const directory = useHostedHubStore((state) => state.directoryStatus);
  const role = useHostedHubStore((state) => state.effectiveRole);
  const error = useHostedHubStore((state) => state.errorMessage);
  const browserStatus = useHostedHubStore((state) => state.browserStatus);
  const navigate = useNavigate();
  if (!node) return null;

  const switchNode = async (next: HostedHubNode) => {
    if (selectHostedNodeRoute(next.id)) return;
    await navigate({ to: "/", replace: true });
    await hostedHubController.selectNode(next.id);
  };

  const statusText =
    browserStatus === "offline"
      ? "Offline"
      : browserStatus === "checking-access"
        ? "Checking access"
        : browserStatus === "synchronizing"
          ? "Synchronizing"
          : browserStatus === "suspended" || browserStatus === "stale"
            ? "Stale"
            : session === "delivery-unknown"
              ? "Delivery unknown"
              : selection === "authorization-removed"
                ? "Authorization removed"
                : selection === "revoked"
                  ? "Revoked"
                  : selection === "incompatible"
                    ? "Incompatible"
                    : transport === "online" && session === "ready"
                      ? "Online"
                      : transport === "reconnecting"
                        ? "Reconnecting"
                        : selection === "offline"
                          ? "Offline"
                          : transport.replaceAll("-", " ");

  return (
    <div className="fixed top-2 right-2 z-50 max-w-[calc(100vw-1rem)] sm:top-3 sm:right-3">
      <details className="group relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 text-sm shadow-lg backdrop-blur outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {transport === "online" ? (
            <WifiIcon aria-hidden className="size-4 text-emerald-500" />
          ) : (
            <WifiOffIcon aria-hidden className="size-4 text-amber-500" />
          )}
          <span className="max-w-32 truncate font-medium">{node.label}</span>
          <span className="max-w-24 truncate text-xs text-muted-foreground">{statusText}</span>
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-popover p-3 shadow-xl">
          <p className="font-medium">{node.label}</p>
          <p className="mt-0.5 text-xs capitalize text-muted-foreground">
            {role ?? "Role unavailable"} · {statusText}
          </p>
          <p className="sr-only" aria-live="polite">
            Node {node.label}: {statusText}.
          </p>
          {error ? (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {error}
            </p>
          ) : null}
          {session === "delivery-unknown" ? (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
              <p>
                A request may or may not have reached the node. Ryco did not resend it
                automatically.
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                disabled={!recoveredAfterUnknown}
                title={
                  recoveredAfterUnknown
                    ? undefined
                    : "Wait for session replay to finish before acknowledging this warning."
                }
                onClick={() => hostedHubController.acknowledgeDeliveryUnknown()}
              >
                {recoveredAfterUnknown ? "Acknowledge" : "Synchronizing…"}
              </Button>
            </div>
          ) : null}
          <div className="mt-3 max-h-48 space-y-1 overflow-auto border-t border-border pt-3">
            {nodes
              .filter((candidate) => candidate.id !== node.id)
              .map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={
                    directory !== "ready" ||
                    browserStatus !== "current" ||
                    candidate.revokedAt !== null
                  }
                  className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void switchNode(candidate)}
                >
                  <span className="truncate">{candidate.label}</span>
                  <NodePresence node={candidate} />
                </button>
              ))}
          </div>
          <div className="mt-3 flex gap-2 border-t border-border pt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void hostedHubController.refreshDirectory()}
            >
              <RefreshCwIcon aria-hidden /> Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void hostedHubController.signOut()}>
              <LogOutIcon aria-hidden /> Sign out
            </Button>
          </div>
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <HostedRelayTrustNotice compact />
            <HostedPwaControls compact />
          </div>
        </div>
      </details>
    </div>
  );
}

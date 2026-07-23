import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  KeyRoundIcon,
  LogOutIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
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
import { useHostedBrowserLifecycle } from "../../hostedHub/useHostedBrowserLifecycle";
import { usePresentationTier } from "../../hooks/usePresentationTier";
import { PHONE_ANCHORED_ACTIONS_CLASS_NAME } from "../mobile/phoneAnchoredActions";
import { HostedConnectionControl, NodePresence } from "./HostedConnectionControls";
import { HostedNodeEnrollmentFlow } from "./HostedNodeEnrollment";
import { HostedPwaControls } from "./HostedPwaControls";
import { HostedRelayTrustNotice } from "./HostedRelayTrustNotice";

// Browser suites and callers keep importing the menu from the hosted root.
export { HostedNodeMenu } from "./HostedConnectionControls";

export function HostedHubRoot() {
  const accountStatus = useHostedHubStore((state) => state.accountStatus);
  const selectedNode = useHostedHubStore((state) => state.selectedNode);
  const recoveryCodes = useHostedHubStore((state) => state.recoveryCodes);
  const transportStatus = useHostedHubStore((state) => state.transportStatus);
  const sessionEstablished = useHostedHubStore((state) => state.sessionEstablished);
  const errorMessage = useHostedHubStore((state) => state.errorMessage);
  const routedNode = useRoutedHostedNode();
  useHostedNodeRouteOrchestrator();
  // The single browser lifecycle owner, above the presentation-tier seam: the
  // tier shells mount no lifecycle listeners of their own.
  useHostedBrowserLifecycle();

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
    return <HostedNodeFailureSurface node={selectedNode} message={errorMessage} />;
  }
  if (!sessionEstablished) {
    return <HostedNodeStartingSurface node={selectedNode} />;
  }

  // The hosted connection controls render inside the shell (workspace header
  // on desktop, app-bar pill on the phone tier) — never as a floating overlay.
  return <RootAppShell authGateState={{ status: "hosted-hub" }} />;
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
      <div className="mb-4 flex justify-end">
        <HostedConnectionControl />
      </div>
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

function Surface({
  children,
  actions,
  trailing,
}: {
  readonly children: React.ReactNode;
  /**
   * The surface's action group. Bottom-anchored on the phone tier by its own
   * `phone:` classes; it may be absent in a state that has no action group.
   */
  readonly actions?: React.ReactNode;
  /**
   * Content that must mount in **every** state of the surface and must stay
   * last in the DOM — live regions and recovery affordances. Kept separate
   * from `actions` precisely so it cannot be swallowed by a conditional that
   * only applies to the action group.
   */
  readonly trailing?: React.ReactNode;
}) {
  // Phone layout system: safe-area-aware edge padding so hosted entry
  // surfaces stay fully reachable on notched, edge-to-edge phone viewports.
  // The gating order of the surfaces themselves is unchanged.
  //
  // `#root` is `overflow-y: hidden`, so a card taller than the viewport used to
  // be clipped with no way to reach its primary action (at 320x568 "Sign in
  // with passkey" fell below the fold). The surface owns its own vertical
  // scroll, and the card is centred with `my-auto` on a `min-h-full` track
  // instead of `items-center`, which would clip the overflowing top edge.
  //
  // On the phone tier the card chrome recedes and the surface fills the
  // viewport instead: no rounded floating card, no centring, and the content
  // column grows so the action group below it can be bottom-anchored.
  return (
    <main className="h-dvh overflow-x-hidden overflow-y-auto overscroll-contain bg-background text-foreground">
      <div className="flex min-h-full flex-col px-4 py-10 sm:px-6 phone:px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] phone:pt-[max(2.5rem,calc(env(safe-area-inset-top)+1rem))] phone:pb-[max(2.5rem,calc(env(safe-area-inset-bottom)+1rem))]">
        <section className="my-auto w-full max-w-lg self-center rounded-2xl border border-border bg-card p-5 shadow-lg shadow-black/5 sm:p-8 phone:my-0 phone:flex phone:max-w-none phone:flex-1 phone:flex-col phone:rounded-none phone:border-0 phone:bg-transparent phone:p-0 phone:shadow-none">
          {children}
          {actions}
          {trailing}
        </section>
      </div>
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

  // The action group keeps the exact DOM order and desktop styling it had —
  // the primary stack, then the Hub retry, then the polite announcement — so
  // the desktop card is unchanged. Only the outer wrapper is phone-gated.
  //
  // The stack itself is the only part gated on registration mode: while the
  // registration form is open it owns the primary action. The Hub retry and
  // the polite announcement are NOT part of this group — see `signInTrailing`.
  const signInActions = registrationMode ? null : (
    <div className={`phone:mt-auto ${PHONE_ANCHORED_ACTIONS_CLASS_NAME}`}>
      <div className="mt-6 flex flex-col gap-3">
        <Button
          size="lg"
          className="phone:min-h-11"
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
            className="phone:min-h-11"
            onClick={() => hostedHubController.cancelAuthentication()}
          >
            Cancel
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="lg"
              className="phone:min-h-11"
              onClick={() => setRegistrationMode("invitation")}
            >
              Redeem invitation
            </Button>
            {bootstrapAvailable ? (
              <Button
                variant="outline"
                size="lg"
                className="phone:min-h-11"
                onClick={() => setRegistrationMode("bootstrap")}
              >
                Set up first owner
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  // Both of these must mount in EVERY account state, including while the
  // registration form is open. Redeeming an invitation and bootstrapping the
  // first owner both drive `accountStatus` to `authenticating` exactly as
  // sign-in does, and the WebAuthn ceremony then runs for seconds: without a
  // mounted polite region a screen-reader user is told nothing at all, and the
  // form's `role="alert"` only speaks on failure. `Retry Hub` is the recovery
  // path out of an unavailable Hub and must not disappear either. They live in
  // `trailing` rather than inside the action group so no future conditional on
  // the group can take them out of the DOM again.
  const signInTrailing = (
    <>
      {status === "unavailable" ? (
        <Button
          className="mt-3 phone:min-h-11"
          variant="ghost"
          onClick={() => void hostedHubController.bootstrap()}
        >
          <RefreshCwIcon aria-hidden /> Retry Hub
        </Button>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {status === "authenticating" ? "Passkey authentication is in progress." : ""}
      </p>
    </>
  );

  return (
    <Surface actions={signInActions} trailing={signInTrailing}>
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
      ) : null}
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
    <form
      className="mt-6 space-y-4 phone:flex phone:flex-1 phone:flex-col"
      onSubmit={(event) => void submit(event)}
      autoComplete="off"
    >
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
          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring phone:h-11"
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
          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring phone:h-11"
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
          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring phone:h-11"
        />
      </div>
      <div className={`flex flex-wrap gap-2 phone:mt-auto ${PHONE_ANCHORED_ACTIONS_CLASS_NAME}`}>
        <Button type="submit" className="phone:min-h-11" disabled={status === "authenticating"}>
          {mode === "invitation" ? "Create account and passkey" : "Create owner and passkey"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="phone:min-h-11"
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
    <Surface
      actions={
        <div className={`phone:mt-auto ${PHONE_ANCHORED_ACTIONS_CLASS_NAME}`}>
          <Button
            className="mt-5 phone:min-h-11 phone:w-full"
            onClick={() => hostedHubController.dismissRecoveryCodes()}
          >
            I saved the codes
          </Button>
        </div>
      }
    >
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
  const isPhoneTier = usePresentationTier() === "phone";
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
    <Surface
      actions={
        <div className={`phone:mt-auto ${PHONE_ANCHORED_ACTIONS_CLASS_NAME}`}>
          <Button
            className="mt-5 phone:min-h-11"
            variant="outline"
            disabled={status === "loading"}
            onClick={() => void hostedHubController.refreshDirectory()}
          >
            <RefreshCwIcon aria-hidden /> Refresh nodes
          </Button>
          {account?.role === "owner" ? (
            <Button className="mt-3 phone:min-h-11" onClick={() => setEnrolling(true)}>
              <ServerIcon aria-hidden /> Enroll node
            </Button>
          ) : null}
          {/* The phone tier renders sign-out here as a labelled action rather
              than as the icon-only control in the card's top-right corner, so
              exactly one sign-out control exists per tier. It stays enabled
              regardless of directory freshness: the fail-closed rules gate
              node switching, never signing out. */}
          {isPhoneTier ? (
            <Button
              className="mt-3 min-h-11"
              variant="outline"
              onClick={() => void hostedHubController.signOut()}
            >
              <LogOutIcon aria-hidden /> Sign out
            </Button>
          ) : null}
        </div>
      }
    >
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
        {isPhoneTier ? null : (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Sign out"
            onClick={() => void hostedHubController.signOut()}
          >
            <LogOutIcon aria-hidden />
          </Button>
        )}
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
    </Surface>
  );
}

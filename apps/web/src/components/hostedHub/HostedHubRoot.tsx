import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  Loader2Icon,
  LogOutIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";

import { LazySettingsDialogMount } from "../AppSidebarLayout";
import { RootAppShell } from "../RootAppShell";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Input, TOUCH_INPUT_CLASS_NAME } from "../ui/input";
import { Label } from "../ui/label";
import { Skeleton } from "../ui/skeleton";
import { AnchoredToastProvider, ToastProvider } from "../ui/toast";
import { APP_DISPLAY_NAME } from "../../branding";
import { formatRecoveryCodesForClipboard } from "../settings/AccountSettings.logic";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import {
  HOSTED_SESSION_SYNC_FAILURE_MESSAGE,
  hostedHubController,
  useHostedHubStore,
  useHostedRecoveryCodeDisplayStore,
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
import { useSettingsDialogStore } from "../../settingsDialogStore";
import { PHONE_ANCHORED_ACTIONS_CLASS_NAME } from "../mobile/phoneAnchoredActions";
import {
  HostedConnectionControl,
  NodePresence,
  useHostedConnectionActions,
} from "./HostedConnectionControls";
import { HostedNodeDetail } from "./HostedNodeDetail";
import {
  directoryCountLine,
  lastSeenLabel,
  nodeMetaLine,
  nodeSelectionBlocked,
  sortNodes,
} from "./HostedNodeDisplay.logic";
import { HostedNodeEnrollmentFlow } from "./HostedNodeEnrollment";
import { HostedPwaControls } from "./HostedPwaControls";
import { HostedRelayTrustNotice } from "./HostedRelayTrustNotice";

// Browser suites and callers keep importing the menu from the hosted root.
export { HostedNodeMenu } from "./HostedConnectionControls";

/**
 * The chrome an authenticated hosted surface needs before a node is selected.
 *
 * `LazySettingsDialogMount` used to be rendered from exactly one place —
 * `AppSidebarLayout`, inside `RootAppShell` — which `HostedHubRoot` only ever
 * reaches at its last gate. A user with zero nodes, only offline nodes, or only
 * revoked nodes therefore could not open account settings at all: `openSettings`
 * is a global singleton and flipped silently against no mount.
 *
 * The toast providers are required rather than decorative. `AppearanceSettings`
 * — one of the two sections a hosted session can reach before it has a node —
 * calls the module-level `toastManager` at five sites, and without a mounted
 * host those toasts queue and never render.
 *
 * **Invariant:** exactly one `LazySettingsDialogMount` exists at any moment. The
 * surfaces wrapped here and `RootAppShell` are opposite branches of the same
 * switch in `HostedHubRoot`, so they are mutually exclusive by construction.
 * Never add a third mount.
 */
function HostedEntryChrome({ children }: { readonly children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        {children}
        <LazySettingsDialogMount />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

export function HostedHubRoot() {
  const accountStatus = useHostedHubStore((state) => state.accountStatus);
  const selectedNode = useHostedHubStore((state) => state.selectedNode);
  const recoveryCodes = useHostedHubStore((state) => state.recoveryCodes);
  const transportStatus = useHostedHubStore((state) => state.transportStatus);
  const sessionEstablished = useHostedHubStore((state) => state.sessionEstablished);
  const errorMessage = useHostedHubStore((state) => state.errorMessage);
  const recoveryCodesLeased = useHostedRecoveryCodeDisplayStore((state) => state.leased);
  const routedNode = useRoutedHostedNode();
  useHostedNodeRouteOrchestrator();
  // The single browser lifecycle owner, above the presentation-tier seam: the
  // tier shells mount no lifecycle listeners of their own.
  useHostedBrowserLifecycle();

  // Not wrapped in `HostedEntryChrome`: there is no account to configure yet.
  if (accountStatus !== "authenticated") return <HostedAuthenticationSurface />;
  // The post-bootstrap "save your codes" step owns the viewport because at that
  // point there is no shell to show it inside. Once a surface within the running
  // app is displaying them — account settings regenerating them — taking the
  // viewport would tear that surface down mid-flow, so the lease wins.
  //
  // It is also the safety net for a set of codes whose display went away
  // without an acknowledgement: they stay in the runtime's slot, so this takes
  // over and puts them in front of the user rather than leaving the account
  // holding codes its owner never saw.
  //
  // Also not wrapped in `HostedEntryChrome`: this is a one-shot secret display
  // and nothing may compete with its acknowledgement.
  if (recoveryCodes.length > 0 && !recoveryCodesLeased) return <RecoveryCodesSurface />;
  if (!selectedNode) {
    // A routed node segment is pending fail-closed validation: keep the UI on
    // a read-only restoring surface instead of flashing the directory. The
    // orchestrator either selects the node or clears the segment.
    if (routedNode.nodeId !== null) {
      return (
        <HostedEntryChrome>
          <HostedNodeRestoringSurface />
        </HostedEntryChrome>
      );
    }
    return (
      <HostedEntryChrome>
        <HostedNodeDirectory />
      </HostedEntryChrome>
    );
  }
  if (transportStatus === "terminal-failure") {
    return (
      <HostedEntryChrome>
        <HostedNodeFailureSurface node={selectedNode} message={errorMessage} />
      </HostedEntryChrome>
    );
  }
  if (!sessionEstablished) {
    return (
      <HostedEntryChrome>
        <HostedNodeStartingSurface node={selectedNode} />
      </HostedEntryChrome>
    );
  }

  // The hosted connection controls render inside the shell (workspace header
  // on desktop, app-bar pill on the phone tier) — never as a floating overlay.
  return <RootAppShell authGateState={{ status: "hosted-hub" }} />;
}

/**
 * The in-paragraph progress glyph for a surface that is waiting.
 *
 * Deliberately `Loader2Icon` rather than `ui/spinner.tsx`: `Spinner` hardcodes
 * `role="status"` and `aria-label="Loading"`, and these paragraphs are already
 * live regions — nesting one inside the other creates a second region and a
 * duplicate announcement of a state that is being announced properly.
 */
function InlineProgress() {
  return (
    <Loader2Icon
      aria-hidden
      className="mr-2 inline size-4 animate-spin align-[-0.15em] motion-reduce:animate-none"
    />
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
      {/* Already carries "All nodes", "Refresh", "Account" and "Sign out", so
          the terminal-failure state needs no escape of its own. */}
      <div className="mb-4 flex justify-end">
        <HostedConnectionControl />
      </div>
      <TriangleAlertIcon aria-hidden className="size-8 text-destructive" />
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
  // No escape here on purpose: this is a single-round-trip fail-closed
  // validation whose URL the route orchestrator owns, and an escape would race
  // the reconcile.
  return (
    <Surface>
      <ServerIcon aria-hidden className="size-8 text-primary" />
      <h1 className="mt-4 text-2xl font-semibold">Restoring your node</h1>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        <InlineProgress />
        Checking your access before reconnecting…
      </p>
    </Surface>
  );
}

function HostedNodeStartingSurface({ node }: { readonly node: HostedHubNode }) {
  const { returnToAllNodes } = useHostedConnectionActions();
  return (
    <Surface
      actions={
        // Until now the only way out of "Connecting to X" was to wait or to
        // reload the page. This uses the same history-back-equivalent teardown
        // the connection controls already use.
        <div className={`phone:mt-auto ${PHONE_ANCHORED_ACTIONS_CLASS_NAME}`}>
          <Button
            variant="outline"
            className="mt-5 phone:min-h-11"
            onClick={() => void returnToAllNodes()}
          >
            Back to nodes
          </Button>
        </div>
      }
    >
      <ServerIcon aria-hidden className="size-8 text-primary" />
      <h1 className="mt-4 text-2xl font-semibold">Connecting to {node.label}</h1>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        <InlineProgress />
        Preparing a private relay session and synchronizing Ryco state…
      </p>
    </Surface>
  );
}

function Surface({
  children,
  actions,
  trailing,
  width = "narrow",
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
  /**
   * The desktop card's measure. `wide` is the node directory alone: a list of
   * rows carrying four facts each reads badly in the `max-w-lg` column that
   * suits a single-column form. Nothing else about the card changes — border,
   * radius, elevation, and every `phone:` override are identical.
   */
  readonly width?: "narrow" | "wide";
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
        <section
          className={`my-auto w-full ${width === "wide" ? "max-w-2xl" : "max-w-lg"} self-center rounded-2xl border border-border bg-card p-5 shadow-lg shadow-black/5 sm:p-8 phone:my-0 phone:flex phone:max-w-none phone:flex-1 phone:flex-col phone:rounded-none phone:border-0 phone:bg-transparent phone:p-0 phone:shadow-none`}
        >
          {children}
          {actions}
          {trailing}
        </section>
      </div>
    </main>
  );
}

/**
 * What a person who has never seen this Hub needs, kept behind one 32px row so
 * the returning user — who is nearly everyone, nearly every time — pays a line
 * of text for it rather than a screen of it.
 */
function NewToThisHubDisclosure({ bootstrapAvailable }: { readonly bootstrapAvailable: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="mt-4">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        className="-mx-2 phone:min-h-11"
        onClick={() => setOpen((current) => !current)}
      >
        New to this Hub?
        <ChevronDownIcon
          aria-hidden
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Button>
      {open ? (
        <div id={panelId} className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Getting access.</span> Accounts are
            created by invitation. An owner of this Hub sends you an invitation code; you redeem it
            below and your browser creates a passkey at the same time.
          </p>
          <p>
            <span className="font-medium text-foreground">What a passkey is here.</span> The passkey
            is created by your browser or password manager and never leaves it. It is the only
            credential this Hub treats as strong.
          </p>
          {bootstrapAvailable ? (
            <p>
              <span className="font-medium text-foreground">If this Hub is brand new.</span> No
              owner exists yet. “Set up first owner” claims this Hub with a bootstrap credential
              from whoever deployed it.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
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
    // `preventScroll`: both targets sit at the top of a surface that owns its
    // own scroller, and a focus-driven scroll would move the anchored action
    // group's content out from under the user before they have touched it.
    if (registrationMode) registrationInputRef.current?.focus({ preventScroll: true });
    else headingRef.current?.focus({ preventScroll: true });
  }, [registrationMode]);

  // The action group keeps the exact DOM order and desktop styling it had —
  // the primary stack, then the Hub retry, then the polite announcement — so
  // the desktop card is unchanged. Only the outer wrapper is phone-gated.
  //
  // The stack itself is the only part gated on registration mode: while the
  // registration form is open it owns the primary action. The Hub retry and
  // the polite announcement are NOT part of this group — see `signInTrailing`.
  // The registration action group lives here rather than inside the `<form>`,
  // and reaches its submit through the `form` attribute.
  //
  // This is not tidying. `position: sticky` can never lift a box above the top
  // of its containing block, so while the group was the form's last child the
  // anchoring silently stopped working as soon as the copy above the form grew
  // enough to push the form's top below the pinned position — measured at
  // 320x568, the group clamped to the form's top edge and its primary action
  // landed 2.5px under the fold. As a sibling of the form its containing block
  // is the surface's own content column, exactly like the sign-in group's.
  const registrationActions = registrationMode ? (
    <div className={`mt-6 flex flex-wrap gap-2 phone:mt-auto ${PHONE_ANCHORED_ACTIONS_CLASS_NAME}`}>
      <Button
        type="submit"
        form={REGISTRATION_FORM_ID}
        className="phone:min-h-11"
        disabled={status === "authenticating"}
      >
        {registrationMode === "invitation"
          ? "Create account and passkey"
          : "Create owner and passkey"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="phone:min-h-11"
        onClick={
          status === "authenticating"
            ? () => hostedHubController.cancelAuthentication()
            : () => setRegistrationMode(null)
        }
      >
        {status === "authenticating" ? "Cancel" : "Back"}
      </Button>
    </div>
  ) : null;

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
            {/* The cold visitor's real path, so it stays an outline rather than
                sinking to ghost. */}
            <Button
              variant="outline"
              size="lg"
              className="phone:min-h-11"
              onClick={() => setRegistrationMode("invitation")}
            >
              Redeem invitation
            </Button>
            {bootstrapAvailable ? (
              // Once per Hub, ever. Reducing its weight does not change its
              // height, so the anchoring geometry is untouched.
              <Button
                variant="ghost"
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
    <Surface actions={signInActions ?? registrationActions} trailing={signInTrailing}>
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
        Ryco Hub reaches the developer machines an owner has authorized for your account. Your
        session lives in an HttpOnly cookie — nothing about it is readable by this page.
      </p>
      <div className="mt-4">
        <HostedRelayTrustNotice />
      </div>
      <NewToThisHubDisclosure bootstrapAvailable={bootstrapAvailable} />
      <HostedPwaControls />
      {error ? (
        <div className="mt-4">
          <Alert variant="error">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>Sign-in did not complete</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {registrationMode ? (
        <RegistrationForm mode={registrationMode} credentialRef={registrationInputRef} />
      ) : null}
    </Surface>
  );
}

/** The id the out-of-form submit control points at. */
const REGISTRATION_FORM_ID = "hub-registration-form";

function RegistrationForm({
  mode,
  credentialRef,
}: {
  readonly mode: "invitation" | "bootstrap";
  readonly credentialRef: RefObject<HTMLInputElement | null>;
}) {
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
      id={REGISTRATION_FORM_ID}
      className="mt-6 space-y-4"
      onSubmit={(event) => void submit(event)}
      autoComplete="off"
    >
      <div className="space-y-1.5">
        <Label htmlFor="hub-registration-credential">
          {mode === "invitation" ? "Invitation code" : "Bootstrap credential"}
        </Label>
        <Input
          ref={credentialRef}
          id="hub-registration-credential"
          type="password"
          required
          maxLength={128}
          value={credential}
          className={TOUCH_INPUT_CLASS_NAME}
          onChange={(event) => setCredential(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="hub-display-name">Display name</Label>
        <Input
          id="hub-display-name"
          required
          maxLength={200}
          value={displayName}
          className={TOUCH_INPUT_CLASS_NAME}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="hub-passkey-label">
          Passkey label <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="hub-passkey-label"
          maxLength={100}
          value={passkeyLabel}
          className={TOUCH_INPUT_CLASS_NAME}
          onChange={(event) => setPasskeyLabel(event.currentTarget.value)}
        />
      </div>
    </form>
  );
}

function RecoveryCodesSurface() {
  const recoveryCodes = useHostedHubStore((state) => state.recoveryCodes);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <Surface
      actions={
        <div className={`phone:mt-auto ${PHONE_ANCHORED_ACTIONS_CLASS_NAME}`}>
          {/* Above the acknowledgement, so the acknowledgement stays the
              group's last child and its fold geometry is unchanged. The
              settings twin has had a copy control since it shipped; the same
              secret at the moment the user needs it most had none. */}
          <Button
            variant="outline"
            className="mt-5 phone:min-h-11 phone:w-full"
            onClick={() =>
              copyToClipboard(formatRecoveryCodesForClipboard(recoveryCodes), undefined)
            }
          >
            {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {isCopied ? "Copied" : "Copy codes"}
          </Button>
          <Button
            className="mt-3 phone:min-h-11 phone:w-full"
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
        {/* The count comes from the set. The Hub validates 1..256 codes, so
            copy or a two-column-of-five layout that assumes a number is wrong
            the day an operator changes it — and "Save your 1 recovery codes"
            is what putting it in the heading produces. */}
        Save all {String(recoveryCodes.length)} codes — they are shown once and cannot be retrieved
        later. Ryco does not save them in browser storage.
      </p>
      <ul
        aria-label="Recovery codes"
        className="mt-5 grid gap-2 rounded-xl border border-border bg-background p-4 font-mono text-sm break-all sm:grid-cols-2"
      >
        {recoveryCodes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    </Surface>
  );
}

function NodeRow({
  node,
  nowMs,
  disabled,
  onConnect,
  onOpenDetail,
}: {
  readonly node: HostedHubNode;
  /**
   * One ticking snapshot for the whole list rather than a timer per row: at
   * twenty nodes the per-row hook was twenty intervals for a label that only
   * changes once a minute.
   */
  readonly nowMs: number;
  readonly disabled: boolean;
  readonly onConnect: () => void;
  readonly onOpenDetail: () => void;
}) {
  const labelId = useId();
  const lastSeen = lastSeenLabel(node, nowMs);

  return (
    // Two sibling controls with a full-height divider — never a button inside a
    // button, never an `absolute inset-0` overlay.
    <li className="flex items-stretch overflow-hidden rounded-xl border border-border bg-background">
      <button
        type="button"
        disabled={disabled}
        onClick={onConnect}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 disabled:hover:bg-transparent phone:min-h-18"
      >
        {/* `ServerIcon` for every platform: lucide has no legitimate macOS or
            Windows mark, and shipping a vendor glyph would be brand
            fabrication as well as colour-adjacent information. */}
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <ServerIcon aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span id={labelId} className="block truncate font-medium">
            {node.label}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{nodeMetaLine(node)}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {/* Revocation is stated exactly once, here, by the unmodified
              presence component; the reason is folded into the meta line. */}
          <NodePresence node={node} />
          {lastSeen ? (
            <span className="whitespace-nowrap text-[11px] text-muted-foreground max-sm:hidden phone:hidden">
              {lastSeen}
            </span>
          ) : null}
        </span>
      </button>
      <span aria-hidden className="w-px shrink-0 bg-border/60" />
      {/* Never disabled — not for a revoked node, not while the directory is
          stale. Being unable to connect is exactly when the metadata is needed;
          disabling this would hide the explanation behind the symptom.
          The accessible NAME is generic and node identity arrives as a
          description, so a reader hears "Node details, button, Studio online"
          and the directory's label queries stay unambiguous. */}
      <button
        type="button"
        aria-label="Node details"
        aria-describedby={labelId}
        onClick={onOpenDetail}
        className="flex w-11 shrink-0 items-center justify-center text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ChevronRightIcon aria-hidden className="size-4" />
      </button>
    </li>
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
  const openSettings = useSettingsDialogStore((state) => state.openSettings);
  const navigate = useNavigate();
  const isPhoneTier = usePresentationTier() === "phone";
  const [enrolling, setEnrolling] = useState(false);
  // The *id*, never the node object. `listNodes` polls every 20 seconds and
  // replaces every row, so a captured `HostedHubNode` is a snapshot of the
  // moment the sheet was opened and stops tracking the machine it describes: a
  // revocation that lands while the sheet is up would leave `Connect` enabled
  // against a `revokedAt` the poll had already set, and the sheet would keep
  // printing an "Online" status, a superseded client version, and a heartbeat
  // age that grows for a node that is heartbeating the whole time.
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nowMs = useRelativeTimeTick(60_000);

  useEffect(() => {
    // Returning from a node used to land focus at the document root. The
    // heading, not the list: moving initial focus into the rows drops a screen
    // reader user past the surface's own title.
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const select = async (node: HostedHubNode) => {
    // With the hosted node history installed, selection navigates into the
    // node-scoped route and the route orchestrator drives `selectNode`.
    if (selectHostedNodeRoute(node.id)) return;
    await navigate({ to: "/", replace: true });
    await hostedHubController.selectNode(node.id);
  };

  if (enrolling) {
    return (
      <Surface>
        <HostedNodeEnrollmentFlow onClose={() => setEnrolling(false)} />
      </Surface>
    );
  }

  const ordered = sortNodes(nodes);
  // Re-resolved on every render, so the sheet reads the same store the rows
  // under it read. A node that leaves the directory entirely closes the sheet
  // rather than stranding it on a machine this account can no longer see.
  const detailNode =
    detailNodeId === null
      ? null
      : (nodes.find((candidate) => candidate.id === detailNodeId) ?? null);
  const isOwner = account?.role === "owner";
  const showEmptyState = status === "ready" && nodes.length === 0;
  // Exactly one enroll control exists at all times: when the empty state owns
  // it, the anchored group drops it.
  const enrollInActions = isOwner && !showEmptyState;

  const accountButton = (
    <Button
      variant="ghost"
      className="min-h-11 flex-1"
      onClick={() => {
        openSettings("account");
      }}
    >
      <UserRoundIcon aria-hidden /> Account
    </Button>
  );
  const signOutButton = (
    <Button
      variant="ghost"
      className="min-h-11 flex-1"
      onClick={() => void hostedHubController.signOut()}
    >
      <LogOutIcon aria-hidden /> Sign out
    </Button>
  );
  // `phone:w-full` is what makes the anchored group three stacked rows rather
  // than inline-flex buttons flowing onto one line at 390px.
  const enrollButton = (
    <Button className="mt-3 phone:min-h-11 phone:w-full" onClick={() => setEnrolling(true)}>
      <ServerIcon aria-hidden /> Enroll node
    </Button>
  );
  const refreshButton = (
    <Button
      className={isPhoneTier ? "mt-3 phone:min-h-11 phone:w-full" : "mt-5"}
      variant="outline"
      disabled={status === "loading"}
      onClick={() => void hostedHubController.refreshDirectory()}
    >
      {status === "loading" ? (
        // Not `ui/spinner.tsx`: its hardcoded `role="status"` would add a live
        // region to a surface whose stale/loading announcements are already
        // deliberate and singular. The label is retained either way.
        <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
      ) : (
        <RefreshCwIcon aria-hidden />
      )}
      Refresh nodes
    </Button>
  );

  return (
    <Surface
      width="wide"
      actions={
        // Three rows at most on the phone tier, primary last: this is what
        // makes the fold assertion hold by construction rather than by a
        // 15-pixel margin, and it puts the most-used control nearest the thumb.
        // The group itself carries no margin of its own — all spacing lives on
        // the children — which is what keeps the desktop group static.
        <div className={`phone:mt-auto ${PHONE_ANCHORED_ACTIONS_CLASS_NAME}`}>
          {isPhoneTier ? (
            <div className="mt-5 flex gap-2">
              {accountButton}
              {signOutButton}
            </div>
          ) : null}
          {isPhoneTier ? null : refreshButton}
          {enrollInActions ? enrollButton : null}
          {isPhoneTier ? refreshButton : null}
        </div>
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
            {nodes.length === 1 ? "Your node" : "Your nodes"}
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            Signed in as {account?.displayName ?? "Hub account"}
            {account ? ` · ${account.role.charAt(0).toUpperCase()}${account.role.slice(1)}` : ""}
          </p>
          {nodes.length > 1 ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {directoryCountLine(nodes)}
            </p>
          ) : null}
        </div>
        {isPhoneTier ? null : (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Account settings"
              onClick={() => {
                openSettings("account");
              }}
            >
              <UserRoundIcon aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Sign out"
              onClick={() => void hostedHubController.signOut()}
            >
              <LogOutIcon aria-hidden />
            </Button>
          </div>
        )}
      </div>
      {/* Advisory, and it explains why the rows are disabled — so `status`,
          not the `Alert` default `alert`, which would interrupt. */}
      {status === "stale" ? (
        <div className="mt-4">
          <Alert variant="warning" role="status">
            <TriangleAlertIcon aria-hidden />
            <AlertDescription>
              Directory data is stale. Actions are disabled until it refreshes.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {/* One error region, first match wins. Three simultaneous red paragraphs
          above a list of disabled rows read as breakage, and only the first is
          ever actionable. The `status !== "stale"` suppression on the store's
          own message is preserved exactly. */}
      <DirectoryError
        selection={selection}
        routeNotice={routeNotice}
        error={status === "stale" ? null : error}
      />
      {showEmptyState ? (
        <DirectoryEmptyState isOwner={isOwner} onEnroll={() => setEnrolling(true)} />
      ) : (
        <>
          <ul role="list" className="mt-5 space-y-2" aria-busy={status === "loading"}>
            {ordered.map((node) => (
              <NodeRow
                key={`${node.id}:${node.environmentId}`}
                node={node}
                nowMs={nowMs}
                disabled={nodeSelectionBlocked({ directoryStatus: status, browserStatus, node })}
                onConnect={() => void select(node)}
                onOpenDetail={() => setDetailNodeId(node.id)}
              />
            ))}
            {status === "loading" && nodes.length === 0 ? (
              <>
                {/* Skeletons only when there is nothing to keep: a refresh over
                    a live list keeps the rows and reports itself on the control
                    that was pressed. Skeletons carry no operable element. */}
                {[0, 1, 2].map((index) => (
                  <li key={index}>
                    <Skeleton className="h-16 w-full rounded-xl" />
                  </li>
                ))}
              </>
            ) : null}
          </ul>
          {status === "loading" && nodes.length === 0 ? (
            <p role="status" aria-live="polite" className="sr-only">
              Loading authorized nodes…
            </p>
          ) : null}
          {nodes.length > 0 ? (
            // The honest counterweight to a green pill that can be 20 seconds
            // stale — longer while the tab is backgrounded.
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              Presence refreshes about every 20 seconds.
            </p>
          ) : null}
        </>
      )}
      <div className="mt-5">
        <HostedRelayTrustNotice />
      </div>
      <HostedPwaControls />
      <HostedNodeDetail
        node={detailNode}
        directoryStatus={status}
        browserStatus={browserStatus}
        onOpenChange={(open) => {
          if (!open) setDetailNodeId(null);
        }}
        onConnect={(node) => void select(node)}
      />
    </Surface>
  );
}

function DirectoryError({
  selection,
  routeNotice,
  error,
}: {
  readonly selection: string;
  readonly routeNotice: string | null;
  readonly error: string | null;
}) {
  const selectionMessage =
    selection === "authorization-removed"
      ? "Authorization for the previous node was removed."
      : selection === "revoked"
        ? "The previous node or grant was revoked."
        : selection === "incompatible"
          ? "The previous node uses an incompatible relay version."
          : null;
  const message = selectionMessage ?? routeNotice ?? error;
  if (!message) return null;
  return (
    <div className="mt-4">
      <Alert variant="error">
        <TriangleAlertIcon aria-hidden />
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
}

function DirectoryEmptyState({
  isOwner,
  onEnroll,
}: {
  readonly isOwner: boolean;
  readonly onEnroll: () => void;
}) {
  return (
    <Empty className="min-h-64">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {isOwner ? <ServerIcon aria-hidden /> : <ShieldCheckIcon aria-hidden />}
        </EmptyMedia>
        <EmptyTitle>No nodes yet</EmptyTitle>
        <EmptyDescription>
          {isOwner
            ? "A node appears here once the Ryco client on that machine has been enrolled. Start enrollment on the node, then enter the short device code it shows — codes expire after ten minutes."
            : "A node appears here once an owner of this Hub authorizes your account for it."}
        </EmptyDescription>
      </EmptyHeader>
      {/* No disabled Enroll button for a non-owner: a greyed control implies
          the capability is coming. */}
      {isOwner ? (
        <EmptyContent>
          <Button className="phone:min-h-11" onClick={onEnroll}>
            <ServerIcon aria-hidden /> Enroll node
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

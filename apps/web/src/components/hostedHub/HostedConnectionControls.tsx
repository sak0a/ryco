import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  LayoutGridIcon,
  LogOutIcon,
  RefreshCwIcon,
  UserRoundIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { useSettingsDialogStore } from "../../settingsDialogStore";
import { Button } from "../ui/button";
import { MobileListRow } from "../mobile/MobileListRow";
import {
  MobileSheet,
  MobileSheetDescription,
  MobileSheetHeader,
  MobileSheetPanel,
  MobileSheetTitle,
} from "../mobile/MobileSheet";
import { MobileStatusChip } from "../mobile/MobileStatusChip";
import {
  deriveHostedConnectionStatusIndicator,
  deriveHostedConnectionStatusText,
} from "../../hostedHub/connectionStatus";
import {
  leaveHostedNodeRouteToDirectory,
  selectHostedNodeRoute,
} from "../../hostedHub/nodeRouteOrchestrator";
import { hostedHubController, useHostedHubStore } from "../../hostedHub/state";
import type { HostedHubNode } from "../../hostedHub/types";
import { usePresentationTier } from "../../hooks/usePresentationTier";
import { HostedPwaControls } from "./HostedPwaControls";
import { HostedRelayTrustNotice } from "./HostedRelayTrustNotice";

export function NodePresence({ node }: { readonly node: HostedHubNode }) {
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

export function useHostedConnectionActions() {
  const navigate = useNavigate();

  const switchNode = async (next: HostedHubNode) => {
    if (selectHostedNodeRoute(next.id)) return;
    await navigate({ to: "/", replace: true });
    await hostedHubController.selectNode(next.id);
  };

  // "All nodes": deterministically close the browser relay session and
  // release its channel while the remote node connector stays online —
  // distinct from sign-out and from node revocation. With the hosted node
  // history installed the route orchestrator drives the same teardown as
  // history Back; otherwise the controller primitive runs directly.
  const returnToAllNodes = async () => {
    if (leaveHostedNodeRouteToDirectory()) return;
    await navigate({ to: "/", replace: true });
    await hostedHubController.returnToDirectory();
  };

  return { switchNode, returnToAllNodes };
}

function DeliveryUnknownAcknowledgement() {
  const session = useHostedHubStore((state) => state.sessionStatus);
  const recoveredAfterUnknown = useHostedHubStore((state) => state.sessionRecoveredAfterUnknown);
  if (session !== "delivery-unknown") return null;
  return (
    <div
      role="alert"
      className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs"
    >
      <p>A request may or may not have reached the node. Ryco did not resend it automatically.</p>
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
  );
}

/**
 * The hosted node connection menu (desktop presentation). Renders in normal
 * flow — callers place it inside the workspace header's inline actions or an
 * entry surface — so it can never overlap other header controls. Returns null
 * while no node is selected, which also covers every non-hosted mode.
 */
export function HostedNodeMenu() {
  const node = useHostedHubStore((state) => state.selectedNode);
  const nodes = useHostedHubStore((state) => state.nodes);
  const transport = useHostedHubStore((state) => state.transportStatus);
  const session = useHostedHubStore((state) => state.sessionStatus);
  const selection = useHostedHubStore((state) => state.selectionStatus);
  const directory = useHostedHubStore((state) => state.directoryStatus);
  const role = useHostedHubStore((state) => state.effectiveRole);
  const error = useHostedHubStore((state) => state.errorMessage);
  const browserStatus = useHostedHubStore((state) => state.browserStatus);
  const openSettings = useSettingsDialogStore((state) => state.openSettings);
  const { switchNode, returnToAllNodes } = useHostedConnectionActions();
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  if (!node) return null;

  const statusText = deriveHostedConnectionStatusText({
    browserStatus,
    sessionStatus: session,
    selectionStatus: selection,
    transportStatus: transport,
  });

  return (
    <div className="relative max-w-full">
      <details ref={disclosureRef} className="group relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-popover p-3 shadow-xl">
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
          <DeliveryUnknownAcknowledgement />
          <div className="mt-3 max-h-48 space-y-1 overflow-auto border-t border-border pt-3">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void returnToAllNodes()}
            >
              <LayoutGridIcon aria-hidden className="size-4" /> All nodes
            </button>
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
          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // Close first, exactly as the phone sheet twin does: the
                // settings surface is modal and takes focus, and a disclosure
                // left open underneath it makes two owners of one dismissal —
                // Escape closes the dialog and returns focus into a popover the
                // user believes they already left.
                if (disclosureRef.current) disclosureRef.current.open = false;
                openSettings("account");
              }}
            >
              <UserRoundIcon aria-hidden /> Account
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

/**
 * The phone connection sheet: the full hosted connection control set as a
 * bottom sheet — node status and effective role, delivery-unknown
 * acknowledgment, "All nodes" (close the browser relay session and return to
 * the directory), node switching with the directory's fail-closed disables,
 * directory refresh, install/update controls, the relay-trust disclosure, and
 * sign out. Sign out stays available in every state.
 */
export function HostedConnectionSheet({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const node = useHostedHubStore((state) => state.selectedNode);
  const nodes = useHostedHubStore((state) => state.nodes);
  const transport = useHostedHubStore((state) => state.transportStatus);
  const session = useHostedHubStore((state) => state.sessionStatus);
  const selection = useHostedHubStore((state) => state.selectionStatus);
  const directory = useHostedHubStore((state) => state.directoryStatus);
  const role = useHostedHubStore((state) => state.effectiveRole);
  const error = useHostedHubStore((state) => state.errorMessage);
  const browserStatus = useHostedHubStore((state) => state.browserStatus);
  const openSettings = useSettingsDialogStore((state) => state.openSettings);
  const { switchNode, returnToAllNodes } = useHostedConnectionActions();
  if (!node) return null;

  const statusInput = {
    browserStatus,
    sessionStatus: session,
    selectionStatus: selection,
    transportStatus: transport,
  };
  const statusText = deriveHostedConnectionStatusText(statusInput);
  const { connected } = deriveHostedConnectionStatusIndicator(statusInput);
  const switchingDisabled = directory !== "ready" || browserStatus !== "current";

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} label="Connection">
      <MobileSheetHeader>
        <MobileSheetTitle className="flex items-center gap-2">
          {/* The glyph follows the derived state, not the transport alone, so
              it cannot contradict the text under it. */}
          {connected ? (
            <WifiIcon aria-hidden className="size-4 text-emerald-500" />
          ) : (
            <WifiOffIcon aria-hidden className="size-4 text-amber-500" />
          )}
          <span className="truncate">{node.label}</span>
        </MobileSheetTitle>
        <MobileSheetDescription className="capitalize">
          {role ?? "Role unavailable"} · {statusText}
        </MobileSheetDescription>
        <p className="sr-only" aria-live="polite">
          Node {node.label}: {statusText}.
        </p>
      </MobileSheetHeader>
      <MobileSheetPanel>
        {error ? (
          <p role="status" className="text-xs text-muted-foreground">
            {error}
          </p>
        ) : null}
        <DeliveryUnknownAcknowledgement />
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          <MobileListRow
            label="Account"
            icon={<UserRoundIcon aria-hidden className="size-4 shrink-0" />}
            onClick={() => {
              // Close first: the settings surface is its own full-screen sheet
              // and must not open behind this one.
              onOpenChange(false);
              openSettings("account");
            }}
          />
          <MobileListRow
            label="All nodes"
            icon={<LayoutGridIcon aria-hidden className="size-4 shrink-0" />}
            onClick={() => {
              onOpenChange(false);
              void returnToAllNodes();
            }}
          />
          {nodes
            .filter((candidate) => candidate.id !== node.id)
            .map((candidate) => (
              <MobileListRow
                key={candidate.id}
                label={candidate.label}
                disabled={switchingDisabled || candidate.revokedAt !== null}
                disabledReason={
                  candidate.revokedAt !== null
                    ? "Access to this node was revoked."
                    : "Node switching is unavailable until the directory and this browser are current."
                }
                trailing={<NodePresence node={candidate} />}
                onClick={() => {
                  onOpenChange(false);
                  void switchNode(candidate);
                }}
              />
            ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={directory === "loading"}
            onClick={() => void hostedHubController.refreshDirectory()}
          >
            <RefreshCwIcon aria-hidden /> Refresh nodes
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11"
            onClick={() => void hostedHubController.signOut()}
          >
            <LogOutIcon aria-hidden /> Sign out
          </Button>
        </div>
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <HostedRelayTrustNotice compact />
          <HostedPwaControls compact />
        </div>
      </MobileSheetPanel>
    </MobileSheet>
  );
}

/**
 * The phone connection indicator: the collapsed `MobileStatusChip` hosted by
 * the phone app bars, which expands into the connection sheet on tap. Returns
 * null while no node is selected, which also covers non-hosted modes.
 *
 * The audited pill measured 176×36 and rendered the node label and the state
 * both truncated to unreadability, crowding the app-bar title out at 320 px.
 * Collapsed, the chip renders the icon plus a chosen short label for the
 * derived state: the node label is what yields, because it is the half a
 * reader still receives — the accessible label carries node identity and the
 * COMPLETE bounded status text at collapsed size, and the expanded sheet
 * carries the full text alongside the bounded control set.
 *
 * The two live regions are deliberately siblings of the chip rather than
 * children of it, so shrinking the visible control cannot take them with it.
 */
export function HostedConnectionPill() {
  const node = useHostedHubStore((state) => state.selectedNode);
  const transport = useHostedHubStore((state) => state.transportStatus);
  const session = useHostedHubStore((state) => state.sessionStatus);
  const selection = useHostedHubStore((state) => state.selectionStatus);
  const browserStatus = useHostedHubStore((state) => state.browserStatus);
  const [open, setOpen] = useState(false);
  if (!node) return null;

  const statusInput = {
    browserStatus,
    sessionStatus: session,
    selectionStatus: selection,
    transportStatus: transport,
  };
  const statusText = deriveHostedConnectionStatusText(statusInput);
  const { shortLabel, connected } = deriveHostedConnectionStatusIndicator(statusInput);

  return (
    <>
      {/* Sheet-closed announcements: every derived status change announces
          politely, and delivery-unknown arrival announces assertively — its
          explicit acknowledgment flow lives in the connection sheet. While
          the sheet is open its own live regions cover both, so the pill's
          copies unmount to avoid double announcements. */}
      {open ? null : (
        <>
          <span
            role="status"
            aria-live="polite"
            data-testid="hosted-connection-status-announcer"
            className="sr-only"
          >
            Node {node.label}: {statusText}.
          </span>
          {session === "delivery-unknown" ? (
            <span role="alert" className="sr-only">
              Delivery unknown: a request may or may not have reached the node. Open the connection
              controls to acknowledge.
            </span>
          ) : null}
        </>
      )}
      <MobileStatusChip
        testId="hosted-connection-pill"
        // Node identity and the COMPLETE bounded status text stay in the
        // accessible name at collapsed size; the visible word is that text's
        // leading token, so the visible label remains part of the accessible
        // name.
        label={`Connection: ${node.label}, ${statusText}`}
        status={shortLabel}
        // The glyph follows the same gate order as the text. Choosing it from
        // `transport === "online"` alone put a green connected icon beside
        // `Delivery unknown`, beside `Authorization removed`, and beside a
        // closed ryco session — the states where the icon is doing the most
        // work, because the collapsed chip has no room to explain itself.
        icon={
          connected ? (
            <WifiIcon
              aria-hidden
              data-testid="hosted-connection-icon"
              data-connected="true"
              className="size-3.5 shrink-0 text-emerald-500"
            />
          ) : (
            <WifiOffIcon
              aria-hidden
              data-testid="hosted-connection-icon"
              data-connected="false"
              className="size-3.5 shrink-0 text-amber-500"
            />
          )
        }
        onClick={() => setOpen(true)}
      />
      <HostedConnectionSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Tier-aware hosted connection control: the phone pill (opening the bottom
 * sheet) on the phone tier, the inline desktop menu otherwise. Renders
 * nothing while no hosted node is selected.
 */
export function HostedConnectionControl() {
  const tier = usePresentationTier();
  return tier === "phone" ? <HostedConnectionPill /> : <HostedNodeMenu />;
}

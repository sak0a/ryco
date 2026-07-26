// The node detail surface: the eight `HostedHubNode` members the directory has
// never rendered, in the tier-forked presentation the rest of the hosted
// surfaces already use.
//
// It exists because the row is a one-click affordance and the metadata is the
// thing you need precisely when that click will not work — a revoked grant, an
// incompatible client version, a node that has not been seen in a week. So the
// control that opens this is never disabled, including for a revoked node and
// including while the directory is stale.

import { CheckIcon, CopyIcon } from "lucide-react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { usePresentationTier } from "../../hooks/usePresentationTier";
import type { HostedHubNode } from "../../hostedHub/types";
import {
  MobileSheet,
  MobileSheetDescription,
  MobileSheetFooter,
  MobileSheetHeader,
  MobileSheetPanel,
  MobileSheetTitle,
} from "../mobile/MobileSheet";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { DataList, DataListItem } from "../ui/data-list";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "../ui/sheet";
import { NodePresence } from "./HostedConnectionControls";
import {
  formatEpoch,
  nodeMetaLine,
  nodeSelectionBlocked,
  nodeSelectionBlockedReason,
  platformLabel,
  relativeTime,
  roleLabel,
} from "./HostedNodeDisplay.logic";

export interface HostedNodeDetailProps {
  /**
   * The node as the store holds it **right now**, or `null` when the sheet is
   * closed. The caller must re-resolve this from `hostedHubStore.nodes` on
   * every render rather than holding the object the sheet was opened with:
   * presence, `clientVersion`, and above all `revokedAt` are replaced by a
   * 20-second poll, and every claim below — including `Connect`'s own enabled
   * state — is read straight off whatever is passed here.
   */
  readonly node: HostedHubNode | null;
  readonly directoryStatus: string;
  readonly browserStatus: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConnect: (node: HostedHubNode) => void;
}

function NodeDetailBody({ node }: { readonly node: HostedHubNode }) {
  const nowMs = useRelativeTimeTick(60_000);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const enrolled = formatEpoch(node.createdAt);
  const lastConnected = formatEpoch(node.lastAuthenticatedAt);
  const revoked = formatEpoch(node.revokedAt);
  const grantDiffers = node.grant.role !== node.effectiveRole;

  return (
    <DataList>
      <DataListItem term="Status">
        <NodePresence node={node} />
      </DataListItem>
      <DataListItem term="Last heartbeat">
        {node.presence.lastHeartbeatAt === null ? (
          // NOT "Never": the contract permits a null heartbeat while the node
          // is online, so "never sent a heartbeat" would be a false negative
          // about a machine that is up right now.
          "Not reported"
        ) : (
          <span title={formatEpoch(node.presence.lastHeartbeatAt) ?? undefined}>
            {relativeTime(node.presence.lastHeartbeatAt, nowMs)}
          </span>
        )}
      </DataListItem>
      <DataListItem term="Last connected">
        {/* `lastAuthenticatedAt === null` genuinely does mean never. */}
        {lastConnected ?? "Never"}
      </DataListItem>
      <DataListItem term="Platform">
        {`${platformLabel(node.platformOs)} · ${node.platformArch}`}
      </DataListItem>
      <DataListItem term="Client version" mono>
        {node.clientVersion}
      </DataListItem>
      <DataListItem term="Your role">{roleLabel(node.effectiveRole)}</DataListItem>
      {grantDiffers ? (
        <DataListItem term="Granted role">
          {roleLabel(node.grant.role)}
          <span className="mt-1 block text-muted-foreground">
            The role on your grant differs from the role in effect.
          </span>
        </DataListItem>
      ) : null}
      <DataListItem term="Enrolled">{enrolled ?? "Not reported"}</DataListItem>
      {node.revokedAt !== null ? (
        <DataListItem term="Revoked">
          {`${revoked ?? "Not reported"}${node.revocationReasonCode ? ` — ${node.revocationReasonCode}` : ""}`}
        </DataListItem>
      ) : null}
      <DataListItem
        term="Node ID"
        mono
        action={
          <Button
            size="icon-xs"
            variant="ghost"
            // Icon-only, so the label *is* the accessible name and has to swap
            // with the glyph rather than staying "Copy node ID" after a copy.
            aria-label={isCopied ? "Copied" : "Copy node ID"}
            onClick={() => copyToClipboard(node.id, undefined)}
          >
            {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          </Button>
        }
      >
        {node.id}
      </DataListItem>
    </DataList>
  );
}

/**
 * The tier-forked node detail sheet — the desktop side panel, the phone bottom
 * sheet — over one shared body. `MobileSheet` applies its own `pb-safe`, so
 * this call site must not repeat it.
 */
export function HostedNodeDetail({
  node,
  directoryStatus,
  browserStatus,
  onOpenChange,
  onConnect,
}: HostedNodeDetailProps) {
  const isPhoneTier = usePresentationTier() === "phone";
  const open = node !== null;
  if (!node) return null;

  const blocked = nodeSelectionBlocked({ directoryStatus, browserStatus, node });
  const blockedReason = nodeSelectionBlockedReason({ directoryStatus, browserStatus, node });
  const connect = () => {
    onOpenChange(false);
    onConnect(node);
  };
  const reason = blocked && blockedReason ? blockedReason : null;

  if (isPhoneTier) {
    return (
      <MobileSheet open={open} onOpenChange={onOpenChange} label={`Node details: ${node.label}`}>
        <MobileSheetHeader>
          <MobileSheetTitle>{node.label}</MobileSheetTitle>
          <MobileSheetDescription>{nodeMetaLine(node)}</MobileSheetDescription>
        </MobileSheetHeader>
        <MobileSheetPanel>
          <NodeDetailBody node={node} />
          {reason ? <p className="mt-4 text-xs text-muted-foreground">{reason}</p> : null}
        </MobileSheetPanel>
        <MobileSheetFooter>
          <Button className="min-h-11" disabled={blocked} onClick={connect}>
            Connect
          </Button>
        </MobileSheetFooter>
      </MobileSheet>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
      }}
    >
      <SheetPopup side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="truncate">{node.label}</SheetTitle>
          <SheetDescription>{nodeMetaLine(node)}</SheetDescription>
        </SheetHeader>
        <SheetPanel>
          <NodeDetailBody node={node} />
          {reason ? <p className="mt-4 text-xs text-muted-foreground">{reason}</p> : null}
        </SheetPanel>
        <SheetFooter>
          <Button disabled={blocked} onClick={connect}>
            Connect
          </Button>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}

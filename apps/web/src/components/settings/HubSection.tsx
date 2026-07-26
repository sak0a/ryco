import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HubConnectorStatus,
  HubEnrollmentCeremonyDetail,
  HubIdentitySummary,
} from "@ryco/contracts";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import {
  cancelHubEnrollment,
  fetchHubEnrollment,
  fetchHubIdentity,
  fetchHubStatus,
  leaveHub,
  resumeHubConnector,
  startHubEnrollment,
} from "~/environments/primary";
import { AnimatedHeight } from "../AnimatedHeight";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { DataList, DataListItem } from "../ui/data-list";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection, useRelativeTimeTick } from "./settingsLayout";
import { canEditHubOrigin, presentHubStatus, type HubAction } from "./hubStatus";

/**
 * Matches the diagnostics panel's cadence.
 *
 * One interval for every state. Polling faster while awaiting approval cannot
 * surface an approval sooner — the server's own enrollment poll runs at the
 * Hub-dictated interval, and this only reads the resulting local snapshot.
 */
const HUB_STATUS_POLL_MS = 5_000;

/** How long a snapshot may age before the panel stops presenting it as current. */
const STALE_AFTER_MS = 15_000;

type HubSnapshot = {
  readonly status: HubConnectorStatus;
  readonly identity: HubIdentitySummary;
  readonly enrollment: HubEnrollmentCeremonyDetail | null;
  readonly readAt: number;
};

const ACTION_LABELS: Record<Exclude<HubAction, "none">, string> = {
  enable: "Enable",
  disable: "Turn off",
  enroll: "Start enrollment",
  "cancel-enrollment": "Cancel",
  "open-hub": "Open Hub",
  retry: "Retry now",
  leave: "Leave this Hub",
  restart: "Restart Ryco",
};

export function HubSection({
  desktopBridge,
}: {
  readonly desktopBridge: typeof window.desktopBridge;
}) {
  const nowMs = useRelativeTimeTick(1_000);
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null);
  const [config, setConfig] = useState<{ enabled: boolean; origin: string | null } | null>(null);
  const [originDraft, setOriginDraft] = useState("");
  const [originError, setOriginError] = useState<string | null>(null);
  const [originSuggestion, setOriginSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<HubAction | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const mountedRef = useRef(true);
  const { copyToClipboard } = useCopyToClipboard();
  // Same derivation the pairing rows use: clipboard writes need a secure context.
  const canCopyToClipboard =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    navigator.clipboard?.writeText != null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [status, identity] = await Promise.all([fetchHubStatus(), fetchHubIdentity()]);
      // Only ask for the ceremony when one can exist; a 404 is the normal answer
      // otherwise and would be noise on every poll.
      const enrollment = status.state === "awaiting_approval" ? await fetchHubEnrollment() : null;
      if (!mountedRef.current) return;
      setSnapshot({ status, identity, enrollment, readAt: Date.now() });
      setError(null);
    } catch (cause) {
      if (!mountedRef.current) return;
      // Keep the last good snapshot, but stop calling it current — see the
      // staleness note below. Never let a dead control plane keep rendering
      // "Connected".
      setError(cause instanceof Error ? cause.message : "Unable to read Hub status.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), HUB_STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!desktopBridge) return;
    void desktopBridge.getHubLaunchConfig().then((value) => {
      if (!mountedRef.current) return;
      setConfig(value);
      setOriginDraft(value.origin ?? "");
    });
  }, [desktopBridge]);

  const runAction = useCallback(
    async (action: HubAction) => {
      setPendingAction(action);
      setError(null);
      try {
        switch (action) {
          case "enroll":
            await startHubEnrollment();
            break;
          case "cancel-enrollment":
            await cancelHubEnrollment();
            break;
          case "retry":
            await resumeHubConnector();
            break;
          case "leave":
            await leaveHub();
            break;
          case "enable":
          case "disable":
            await desktopBridge?.setHubLaunchConfig({ enabled: action === "enable" });
            return; // The app relaunches; nothing after this runs.
          case "open-hub": {
            // The origin root only. The node derives exactly one route from the
            // origin, so synthesising an approval path would invent a Hub
            // routing detail there is no contract for.
            const origin = config?.origin;
            if (origin) window.open(origin, "_blank", "noopener,noreferrer");
            return;
          }
          default:
            return;
        }
        await refresh();
      } catch (cause) {
        if (!mountedRef.current) return;
        setError(cause instanceof Error ? cause.message : "That didn't work.");
      } finally {
        if (mountedRef.current) setPendingAction(null);
      }
    },
    [config, desktopBridge, refresh],
  );

  const handleOriginBlur = useCallback(async () => {
    if (!desktopBridge || originDraft.trim() === "") {
      setOriginError(null);
      setOriginSuggestion(null);
      return;
    }
    const result = await desktopBridge.validateHubOrigin(originDraft);
    if (!mountedRef.current) return;
    if (result.ok) {
      setOriginDraft(result.origin);
      setOriginError(null);
      setOriginSuggestion(null);
      return;
    }
    setOriginSuggestion(result.suggestion ?? null);
    setOriginError(
      {
        empty: "Enter a Hub address.",
        too_long: "That address is too long.",
        not_a_url: "That doesn't look like an address.",
        insecure_scheme: "A Hub address must use https.",
        has_credentials: "Remove the username and password from the address.",
        has_path: "Use the Hub's address only, without a path.",
        invalid: "That address can't be used.",
      }[result.reason],
    );
  }, [desktopBridge, originDraft]);

  const saveOrigin = useCallback(
    async (origin: string) => {
      if (!desktopBridge) return;
      setPendingAction("enable");
      try {
        await desktopBridge.setHubLaunchConfig({ origin });
      } catch (cause) {
        if (!mountedRef.current) return;
        setError(cause instanceof Error ? cause.message : "Unable to save the Hub address.");
        setPendingAction(null);
      }
    },
    [desktopBridge],
  );

  if (!desktopBridge) return null;

  const stale = snapshot !== null && nowMs - snapshot.readAt > STALE_AFTER_MS;
  const presentation =
    snapshot === null ? null : presentHubStatus(snapshot.status, snapshot.identity, nowMs);
  const editable = snapshot === null ? false : canEditHubOrigin(snapshot.identity);
  const originChanged = originDraft.trim() !== (config?.origin ?? "");

  const renderAction = (action: HubAction, variant: "outline" | "destructive-outline") =>
    action === "none" ? null : (
      <Button
        size="xs"
        variant={variant}
        disabled={pendingAction !== null}
        onClick={() => {
          if (action === "leave") {
            setLeaveOpen(true);
            return;
          }
          void runAction(action);
        }}
      >
        {pendingAction === action ? "Working…" : ACTION_LABELS[action]}
      </Button>
    );

  return (
    <SettingsSection title="Hub">
      <SettingsRow
        title="Hub"
        description={
          presentation === null
            ? "Loading…"
            : presentation.detail === null
              ? "Reach this Mac from anywhere — including behind NAT or CGNAT — without opening a port."
              : presentation.detail
        }
        status={
          <>
            {presentation === null ? null : (
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block size-2 shrink-0 rounded-full ${
                    stale
                      ? "bg-muted-foreground/40"
                      : presentation.dot === "success"
                        ? "bg-success"
                        : presentation.dot === "warning"
                          ? "bg-warning"
                          : presentation.dot === "destructive"
                            ? "bg-destructive"
                            : "bg-muted-foreground/40"
                  }`}
                  aria-hidden
                />
                {stale
                  ? `${presentation.headline} · last checked ${Math.round((nowMs - snapshot.readAt) / 1000)}s ago`
                  : presentation.headline}
              </span>
            )}
            {error ? <span className="block text-destructive">{error}</span> : null}
          </>
        }
        control={
          presentation === null ? null : (
            <>
              {renderAction(
                presentation.action,
                presentation.action === "leave" ? "destructive-outline" : "outline",
              )}
              {renderAction(
                presentation.secondaryAction,
                presentation.secondaryAction === "leave" ? "destructive-outline" : "outline",
              )}
            </>
          )
        }
      >
        <AnimatedHeight>
          {snapshot?.enrollment ? (
            <div className="pb-3.5">
              <p className="pb-2 text-xs text-muted-foreground/80">
                Compare every field with the Hub&apos;s approval screen before approving.
              </p>
              {/* The same primitive, fields and order the approval screen uses.
                  A fingerprint that wraps differently on the two screens a
                  reviewer holds side by side is a security-review finding, so
                  `mono` owns that decision in one place rather than here. */}
              <DataList className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <DataListItem term="Label">{snapshot.enrollment.label}</DataListItem>
                <DataListItem term="Platform">
                  {`${snapshot.enrollment.platformOs} · ${snapshot.enrollment.platformArch}`}
                </DataListItem>
                <DataListItem term="Version" mono>
                  {snapshot.enrollment.clientVersion}
                </DataListItem>
                <DataListItem term="Algorithm">{snapshot.enrollment.algorithm}</DataListItem>
                <DataListItem term="Fingerprint" mono>
                  {snapshot.enrollment.fingerprint}
                </DataListItem>
                <DataListItem term="Expires">
                  {new Date(snapshot.enrollment.expiresAt).toLocaleString()}
                </DataListItem>
                {/* Copy belongs on the device code, not the fingerprint: the
                    Hub's entry point is a device-code field, and there is
                    nowhere to paste a fingerprint. */}
                <DataListItem
                  term="Device code"
                  mono
                  action={
                    canCopyToClipboard ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => copyToClipboard(snapshot.enrollment!.deviceCode)}
                      >
                        Copy
                      </Button>
                    ) : null
                  }
                >
                  {snapshot.enrollment.deviceCode}
                </DataListItem>
              </DataList>
              <p className="pt-2 text-[11px] text-muted-foreground/70">
                The device code only routes the request. It does not prove which machine you are
                approving.
              </p>
              <p className="flex items-center gap-1.5 pt-2 text-xs text-warning">
                <TriangleAlertIcon className="size-3.5 shrink-0" />
                If the fingerprint on the Hub differs by even one character, deny it there and
                cancel here.
              </p>
            </div>
          ) : null}
        </AnimatedHeight>
      </SettingsRow>

      <SettingsRow
        title="Hub address"
        description={
          editable
            ? "The address of the Hub you or your team operate."
            : "Locked while this machine is enrolled. Leave this Hub to change it."
        }
        status={
          originError ? (
            <span className="block text-destructive">
              {originError}
              {originSuggestion ? (
                <button
                  type="button"
                  className="ml-1 underline underline-offset-2"
                  onClick={() => {
                    setOriginDraft(originSuggestion);
                    setOriginError(null);
                    setOriginSuggestion(null);
                  }}
                >
                  Use {originSuggestion}
                </button>
              ) : null}
            </span>
          ) : null
        }
        control={
          <>
            <Input
              value={originDraft}
              disabled={!editable || pendingAction !== null}
              placeholder="https://…"
              className="w-64 font-mono text-xs"
              onChange={(event) => setOriginDraft(event.currentTarget.value)}
              onBlur={() => void handleOriginBlur()}
            />
            {editable && originChanged && originError === null && originDraft.trim() !== "" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={pendingAction !== null}
                onClick={() => void saveOrigin(originDraft.trim())}
              >
                Save and restart
              </Button>
            ) : null}
          </>
        }
      />

      {snapshot !== null && snapshot.status.state === "online" ? (
        <SettingsRow
          title="Who can connect"
          description="Managed on the Hub, not here. Sessions arriving through the Hub carry a role: viewer reads, operator edits files and runs terminals, owner also changes credentials and server policy."
        />
      ) : null}

      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this Hub?</AlertDialogTitle>
            <AlertDialogDescription>
              This erases this machine&apos;s Hub key. You can enrol again afterwards, but it will
              join as a new machine and needs a new approval.
              <br />
              <br />
              It does <strong>not</strong> revoke anything on the Hub — the old entry stays there
              until an owner removes it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>Keep it</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={pendingAction !== null}
              onClick={() => {
                setLeaveOpen(false);
                void runAction("leave");
              }}
            >
              Erase this machine&apos;s key
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}

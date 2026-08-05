import { CopyIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  NodeE2eeAuthorizationRequest,
  NodeE2eeClientListing,
  NodeE2eeClientRecord,
  NodeE2eeContinuity,
  NodeE2eeFallback,
  NodeE2eePolicy,
  NodeE2eePolicyChange,
  NodeE2eePolicyProposal,
  NodeE2eePrekey,
  NodeE2eeSessionList,
} from "@ryco/client-runtime/connection";

import { isHostedHubMode } from "../../env";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { deriveHostedConnectionStatusIndicator } from "../../hostedHub/connectionStatus";
import { useHostedHubStore } from "../../hostedHub/state";
import {
  useWebE2eeChannelStatus,
  useWebE2eeVerificationCode,
} from "../../hostedHub/useWebE2eeSession";
import {
  applyNodeE2eeAuthorization,
  applyNodeE2eeContinuity,
  applyNodeE2eePolicy,
  clearNodeE2eeRefusals,
  fetchHubEnrollment,
  fetchNodeE2eeClients,
  fetchNodeE2eeContinuity,
  fetchNodeE2eeFallback,
  fetchNodeE2eePolicy,
  fetchNodeE2eePrekey,
  fetchNodeE2eeSessions,
  previewNodeE2eePolicy,
  recoverNodeE2eePolicyGeneration,
  resetNodeE2eeFallback,
  rotateNodeE2eePrekey,
  setNodeE2eePairingWindow,
} from "~/environments/primary";
import {
  E2EE_WEB_SAS_UNAVAILABLE,
  hostedE2eeVerificationView,
} from "../hostedHub/HostedE2eeVerification.logic";
import { hostedRelayTrustDisclosure } from "../hostedHub/HostedRelayTrustNotice.logic";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import {
  nodeApproveConfirmation,
  nodeClientListingNotices,
  nodeClientRows,
  nodeClientStatusTone,
  nodeConnectionStatement,
  nodeContinuityRemedy,
  nodeContinuityRows,
  nodeE2eeActionConfirmation,
  nodeE2eePolicyGate,
  nodeE2eeStrictPolicyDisposition,
  nodeEnrollmentFingerprintView,
  nodeFallbackReport,
  nodeOperatorDataAvailability,
  nodePairingWindowRows,
  nodePolicyChangeSummary,
  nodePolicyPreviewWarnings,
  nodePolicyRows,
  nodePrekeyRemedy,
  nodePrekeyRows,
  nodeSafetyNumberView,
  nodeSecurityMode,
  nodeSessionRows,
  type NodeE2eeActionConfirmation,
  type NodeE2eeActionId,
  type NodeE2eeApprovableRole,
  type NodeE2eeStrictPolicyDisposition,
  type NodeFactRow,
  NODE_E2EE_APPROVABLE_ROLES,
  NODE_FALLBACK_QUIET,
  NODE_SAFETY_NUMBER_UNAVAILABLE,
  NODE_SESSION_NATIVE_CODE_ABSENT,
} from "./NodeSecuritySettings.logic";

/**
 * The node's E2EE operator surface, as a panel.
 *
 * A UI OVER A COMPLETE API, and over nothing else. Every value below comes from
 * the sixteen `/api/hub/e2ee/…` routes the node already serves — the same data
 * `ryco e2ee` prints — plus the §13 projection this tab already keeps for its own
 * channel. There is no endpoint, schema, or server behaviour added for it.
 *
 * EVERY DECISION IS IN `NodeSecuritySettings.logic.ts`. This file lays out what
 * that module returns and wires buttons to it; nothing here decides what an owner
 * is told, which mode they are in, or whether an action may run.
 *
 * Matches `HubSection`'s cadence: one poll for every state, and the last good
 * snapshot is kept while an error is shown rather than blanked — a panel that
 * empties on a transient failure reads as "no clients are authorized", which is
 * the one wrong answer this data has.
 */
const POLL_INTERVAL_MS = 5_000;

interface NodeSecuritySnapshot {
  readonly clients: NodeE2eeClientListing | null;
  readonly sessions: NodeE2eeSessionList | null;
  readonly policy: NodeE2eePolicy | null;
  readonly prekey: NodeE2eePrekey | null;
  readonly continuity: NodeE2eeContinuity | null;
  readonly fallback: NodeE2eeFallback | null;
  readonly enrollmentFingerprint: string | null;
}

const EMPTY_SNAPSHOT: NodeSecuritySnapshot = {
  clients: null,
  sessions: null,
  policy: null,
  prekey: null,
  continuity: null,
  fallback: null,
  enrollmentFingerprint: null,
};

function FactRows({ rows }: { readonly rows: ReadonlyArray<NodeFactRow> }) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
          <dd
            className={
              row.mono
                ? "min-w-0 font-mono text-[12px] break-all text-foreground"
                : "min-w-0 text-[12px] text-foreground"
            }
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * docs/relay-e2ee-protocol.md §13.4's value, and never the digits alone.
 *
 * The view is one object carrying the number, its format caption, and what a
 * comparison is worth; drawing the number without the sentence takes deleting a
 * field here rather than forgetting a call. Nothing about it is written down:
 * there is no copy button, no `title`, and no form control whose value a browser
 * could restore — §13.4 makes it display-only.
 */
function SafetyNumber({ value }: { readonly value: string }) {
  const view = nodeSafetyNumberView(value);
  if (!view) {
    return (
      <p
        data-testid="node-safety-number"
        data-value="absent"
        className="text-[11px] text-muted-foreground"
      >
        {NODE_SAFETY_NUMBER_UNAVAILABLE}
      </p>
    );
  }
  return (
    <div data-testid="node-safety-number" data-value="present" className="space-y-1.5">
      <p className="text-[11px] font-medium">Comparison number</p>
      {/* Monospace and selectable as a whole: the comparison is digit by digit,
          so a proportional face costs the reader the only check §13.4 gives. */}
      <p
        data-testid="node-safety-number-value"
        className="font-mono text-[13px] leading-relaxed font-semibold tracking-[0.08em] select-all"
      >
        {view.display}
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{view.caption}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{view.advisory}</p>
    </div>
  );
}

/**
 * §13.5's `WebSAS`, through the shipped inseparable value and no other path.
 *
 * `hostedE2eeVerificationView` returns the groups, the caption and §13.5's
 * advisory as one object with the advisory non-optional. This is the only way
 * this panel obtains the characters.
 */
function SessionVerificationCode({ code }: { readonly code: string | null }) {
  const view = hostedE2eeVerificationView(code);
  if (!view) {
    return (
      <p
        data-testid="node-session-code"
        data-code="absent"
        className="text-[11px] text-muted-foreground"
      >
        {E2EE_WEB_SAS_UNAVAILABLE}
      </p>
    );
  }
  return (
    <div data-testid="node-session-code" data-code="present" className="space-y-1.5">
      <p
        data-testid="node-session-code-value"
        className="font-mono text-sm leading-none font-semibold tracking-[0.2em] whitespace-nowrap select-all"
      >
        {view.display}
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{view.caption}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{view.advisory}</p>
    </div>
  );
}

/**
 * Panel 6 — HOSTED ONLY, and absent rather than empty in local mode.
 *
 * There is no relay in local mode, so there is no channel to describe. Rendering
 * this section there with an "unavailable" channel would invite a reader to
 * treat the absence of relay encryption as a finding, which is exactly the
 * indicator this panel must not train them to ignore.
 *
 * The claim itself is the shipped selector's, keyed on the live §4.4 projection,
 * so this surface cannot make a claim the channel has outgrown or one it has not
 * earned.
 */
function ThisConnectionSection() {
  const channelStatus = useWebE2eeChannelStatus();
  const code = useWebE2eeVerificationCode();
  const browserStatus = useHostedHubStore((state) => state.browserStatus);
  const sessionStatus = useHostedHubStore((state) => state.sessionStatus);
  const selectionStatus = useHostedHubStore((state) => state.selectionStatus);
  const transportStatus = useHostedHubStore((state) => state.transportStatus);
  const indicator = deriveHostedConnectionStatusIndicator({
    browserStatus,
    sessionStatus,
    selectionStatus,
    transportStatus,
    e2eeStatus: channelStatus,
  });
  const disclosure = hostedRelayTrustDisclosure(channelStatus);
  const statement = nodeConnectionStatement("hosted", indicator);

  return (
    <SettingsSection title="This connection">
      <SettingsRow
        title={statement.headline}
        description={statement.body}
        status={
          // The word comes from the shared derivation's bounded vocabulary. No
          // status noun is invented here, and none is derived a second time.
          <Badge
            size="sm"
            variant={
              indicator.guarantee === "e2ee"
                ? "success"
                : indicator.guarantee === "web"
                  ? "info"
                  : indicator.guarantee === "legacy"
                    ? "warning"
                    : "outline"
            }
            data-testid="node-connection-claim"
          >
            {indicator.shortLabel}
          </Badge>
        }
      >
        <div className="space-y-3 pb-3.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{disclosure.body}</p>
          {channelStatus === "web-unsigned" ? <SessionVerificationCode code={code} /> : null}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * A confirmation waiting on the owner.
 *
 * It carries the RESOLVED copy rather than an action id, because an approval's
 * copy depends on the role the owner picked — and a dialog that looked its copy
 * up from an id could not name that role in the sentence the owner is agreeing
 * to.
 */
interface PendingConfirmation {
  readonly copy: NodeE2eeActionConfirmation;
  readonly run: () => Promise<void>;
}

export function NodeSecuritySettings() {
  const mode = nodeSecurityMode(isHostedHubMode());
  const availability = nodeOperatorDataAvailability(mode);
  const strictPolicy = nodeE2eeStrictPolicyDisposition(mode);

  const [snapshot, setSnapshot] = useState<NodeSecuritySnapshot>(EMPTY_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    readonly proposal: NodeE2eePolicyProposal;
    readonly warnings: ReadonlyArray<string>;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [windowFingerprint, setWindowFingerprint] = useState("");
  const mountedRef = useRef(true);
  const { copyToClipboard } = useCopyToClipboard();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!availability.available) return;
    try {
      const [clients, sessions, policy, prekey, continuity, fallback] = await Promise.all([
        fetchNodeE2eeClients(),
        fetchNodeE2eeSessions(),
        fetchNodeE2eePolicy(),
        fetchNodeE2eePrekey(),
        fetchNodeE2eeContinuity(),
        fetchNodeE2eeFallback(),
      ]);
      // 404 is the normal answer once a ceremony is over, and the helper already
      // returns null for it rather than throwing.
      const enrollment = await fetchHubEnrollment().catch(() => null);
      if (!mountedRef.current) return;
      setSnapshot({
        clients,
        sessions,
        policy,
        prekey,
        continuity,
        fallback,
        enrollmentFingerprint: enrollment?.fingerprint ?? null,
      });
      setError(null);
    } catch (cause) {
      if (!mountedRef.current) return;
      // The last good snapshot stays on screen: blanking the client list on a
      // transient read failure would read as "nothing is authorized".
      setError(
        cause instanceof Error ? cause.message : "Unable to read the node's security state.",
      );
    }
  }, [availability.available]);

  useEffect(() => {
    void refresh();
    if (!availability.available) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [availability.available, refresh]);

  /** Every mutation goes through here, so none of them can skip the refresh. */
  const run = useCallback(
    async (operation: () => Promise<unknown>, message: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await operation();
        if (mountedRef.current) setNotice(message);
        await refresh();
      } catch (cause) {
        if (!mountedRef.current) return;
        setError(cause instanceof Error ? cause.message : "That didn't work.");
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [refresh],
  );

  const confirmThen = useCallback(
    (action: NodeE2eeActionId, operation: () => Promise<unknown>, message: string) => {
      setConfirmation({
        copy: nodeE2eeActionConfirmation(action),
        run: () => run(operation, message),
      });
    },
    [run],
  );

  /**
   * §12.6: preview first, always.
   *
   * The preview mutates nothing and is a separate route for exactly this reason,
   * so the panel asks it, shows what comes back, and only then offers to apply.
   * There is no code path from a control to `applyNodeE2eePolicy` that does not
   * pass through the preview state below.
   */
  const startPolicyChange = useCallback(
    async (proposal: NodeE2eePolicyProposal) => {
      const gate = nodeE2eePolicyGate(mode, proposal);
      if (!gate.allowed) {
        setError(gate.refusal);
        return;
      }
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const previewed = await previewNodeE2eePolicy(gate.proposal);
        if (!mountedRef.current) return;
        setPreview({
          proposal: gate.proposal,
          warnings: nodePolicyPreviewWarnings(previewed, gate.proposal),
        });
      } catch (cause) {
        if (!mountedRef.current) return;
        setError(cause instanceof Error ? cause.message : "Unable to preview that change.");
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [mode],
  );

  const applyPreviewedPolicy = useCallback(async () => {
    if (preview === null) return;
    // Gated a second time at the point of application. The proposal has been
    // sitting in state while an operator read a warning, and a guard that ran
    // only where the proposal was built would be a guard on a code path rather
    // than on the request.
    const gate = nodeE2eePolicyGate(mode, preview.proposal);
    if (!gate.allowed) {
      setError(gate.refusal);
      setPreview(null);
      return;
    }
    const proposal = gate.proposal;
    setPreview(null);
    await run(async () => {
      const change: NodeE2eePolicyChange = await applyNodeE2eePolicy(proposal);
      if (mountedRef.current) setNotice(nodePolicyChangeSummary(change));
    }, "Policy applied.");
  }, [mode, preview, run]);

  const authorize = useCallback(
    (request: NodeE2eeAuthorizationRequest, action: NodeE2eeActionId, message: string) => {
      confirmThen(action, () => applyNodeE2eeAuthorization(request), message);
    },
    [confirmThen],
  );

  /** An approval, whose confirmation names the role the owner picked (§13.6). */
  const approve = useCallback(
    (request: NodeE2eeAuthorizationRequest, role: NodeE2eeApprovableRole) => {
      setConfirmation({
        copy: nodeApproveConfirmation(role),
        run: () => run(() => applyNodeE2eeAuthorization(request), `Client approved as ${role}.`),
      });
    },
    [run],
  );

  const fingerprintView = nodeEnrollmentFingerprintView(snapshot.enrollmentFingerprint);
  const fallback = useMemo(() => nodeFallbackReport(snapshot.fallback), [snapshot.fallback]);
  const listingNotices = nodeClientListingNotices(snapshot.clients);
  const prekeyRemedy = nodePrekeyRemedy(snapshot.prekey);
  const continuityRemedy = nodeContinuityRemedy(snapshot.continuity);
  const activeConfirmation = confirmation?.copy ?? null;
  const canCopy =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    navigator.clipboard?.writeText != null;

  return (
    <SettingsPageContainer>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">Security</h1>
          <p className="mt-1 text-muted-foreground text-xs">
            What this node will admit, and which client keys it has on file.
          </p>
        </div>
        {availability.available ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void refresh()}>
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertTitle>That didn&apos;t work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="info">
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {/* Panel 6, hosted only. There is no channel in local mode, so there is
          nothing here to describe and no warning to raise about its absence. */}
      {mode === "hosted" ? <ThisConnectionSection /> : null}

      {!availability.available ? (
        <SettingsSection title="This node">
          <SettingsRow
            title={nodeConnectionStatement(mode, null).headline}
            description={availability.unavailableBody}
          />
          <StrictPolicyRow
            disposition={strictPolicy}
            checked={false}
            busy={busy}
            onChange={(checked) => void startPolicyChange({ requireApprovedClientE2EE: checked })}
          />
        </SettingsSection>
      ) : (
        <>
          <SettingsSection title="This node's identity">
            <SettingsRow
              title="Enrollment fingerprint"
              description={fingerprintView.caption}
              control={
                fingerprintView.fingerprint !== null && canCopy ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => copyToClipboard(fingerprintView.fingerprint!)}
                  >
                    <CopyIcon className="size-3.5" />
                    Copy
                  </Button>
                ) : null
              }
            >
              {fingerprintView.fingerprint !== null ? (
                <p
                  data-testid="node-enrollment-fingerprint"
                  className="pb-3.5 font-mono text-[13px] break-all select-all"
                >
                  {fingerprintView.fingerprint}
                </p>
              ) : null}
            </SettingsRow>
            <SettingsRow
              title="Agreement prekey"
              description={prekeyRemedy ?? "The key this node offers for new channels."}
              control={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    confirmThen("rotate-prekey", rotateNodeE2eePrekey, "Prekey rotated.")
                  }
                >
                  Rotate
                </Button>
              }
            >
              <div className="pb-3.5">
                <FactRows rows={nodePrekeyRows(snapshot.prekey)} />
              </div>
            </SettingsRow>
            <SettingsRow
              title="Continuity"
              description={continuityRemedy ?? "The lineage paired clients remember this node by."}
              control={
                <>
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={busy}
                    onClick={() =>
                      confirmThen(
                        "break-continuity",
                        () => applyNodeE2eeContinuity({ action: "break" }),
                        "Continuity chain broken.",
                      )
                    }
                  >
                    Break chain
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={busy}
                    onClick={() =>
                      confirmThen(
                        "remint-continuity",
                        () => applyNodeE2eeContinuity({ action: "remint" }),
                        "Fresh lineage minted.",
                      )
                    }
                  >
                    Mint fresh
                  </Button>
                </>
              }
            >
              <div className="pb-3.5">
                <FactRows rows={nodeContinuityRows(snapshot.continuity)} />
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Authorized clients">
            {listingNotices.map((message) => (
              <SettingsRow key={message} title="Pairing" description={message} />
            ))}
            <SettingsRow
              title="Pairing window"
              description="A window lets exactly one device introduce itself, and only the one whose fingerprint you name."
              control={
                <>
                  <Input
                    value={windowFingerprint}
                    disabled={busy}
                    placeholder="SHA256:…"
                    aria-label="Pairing window fingerprint"
                    className="w-56 font-mono text-xs"
                    onChange={(event) => setWindowFingerprint(event.currentTarget.value)}
                  />
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || windowFingerprint.trim() === ""}
                    onClick={() =>
                      confirmThen(
                        "open-window",
                        () =>
                          setNodeE2eePairingWindow({
                            action: "open",
                            fingerprint: windowFingerprint.trim(),
                          }),
                        "Pairing window opened.",
                      )
                    }
                  >
                    Open
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || snapshot.clients?.pairingWindow === undefined}
                    onClick={() =>
                      confirmThen(
                        "close-window",
                        () => setNodeE2eePairingWindow({ action: "close" }),
                        "Pairing window closed.",
                      )
                    }
                  >
                    Close
                  </Button>
                </>
              }
            >
              <div className="pb-3.5">
                <FactRows rows={nodePairingWindowRows(snapshot.clients)} />
              </div>
            </SettingsRow>
            <SettingsRow
              title="Refused attempts"
              description={`${snapshot.clients?.refusedPairingAttempts ?? 0} attempt(s) refused because the pending list was full.`}
              control={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy || (snapshot.clients?.refusedPairingAttempts ?? 0) === 0}
                  onClick={() =>
                    confirmThen("clear-refusals", clearNodeE2eeRefusals, "Refusal count cleared.")
                  }
                >
                  Clear
                </Button>
              }
            />
            {(snapshot.clients?.records ?? []).map((record) => (
              <ClientRecordRow
                key={`${record.hubOrigin} ${record.accountId} ${record.fingerprint}`}
                record={record}
                busy={busy}
                onAuthorize={authorize}
                onApprove={approve}
              />
            ))}
            {snapshot.clients !== null && snapshot.clients.records.length === 0 ? (
              <SettingsRow
                title="No client keys on file"
                description="No device has introduced itself to this node yet."
              />
            ) : null}
          </SettingsSection>

          <SettingsSection title="Live sessions">
            {(snapshot.sessions?.sessions ?? []).map((session) => (
              <SettingsRow
                key={session.sessionIndex}
                title={`Session ${session.sessionIndex}`}
                description={
                  session.tier === "native"
                    ? NODE_SESSION_NATIVE_CODE_ABSENT
                    : "Compare the code below with the one that browser shows."
                }
              >
                <div className="space-y-3 pb-3.5">
                  <FactRows rows={nodeSessionRows(session)} />
                  {session.tier === "web" ? (
                    <SessionVerificationCode code={session.verificationCode ?? null} />
                  ) : null}
                </div>
              </SettingsRow>
            ))}
            {snapshot.sessions !== null && snapshot.sessions.sessions.length === 0 ? (
              <SettingsRow title="No sessions" description="Nothing is connected right now." />
            ) : null}
          </SettingsSection>

          <SettingsSection title="Admission policy">
            <SettingsRow
              title="Require an encrypted channel"
              description="Refuse plaintext, including for browsers."
              control={
                <Switch
                  checked={snapshot.policy?.requireE2EE ?? false}
                  disabled={busy || snapshot.policy === null}
                  aria-label="Require E2EE"
                  data-testid="require-e2ee"
                  onCheckedChange={(checked) => void startPolicyChange({ requireE2EE: checked })}
                />
              }
            />
            <StrictPolicyRow
              disposition={strictPolicy}
              checked={snapshot.policy?.requireApprovedClientE2EE ?? false}
              busy={busy || snapshot.policy === null}
              onChange={(checked) => void startPolicyChange({ requireApprovedClientE2EE: checked })}
            />
            <SettingsRow
              title="Policy generation"
              description="Recover a generation that a restore rolled back."
              control={
                <Button
                  size="xs"
                  variant="destructive-outline"
                  disabled={busy}
                  onClick={() =>
                    confirmThen(
                      "recover-policy",
                      recoverNodeE2eePolicyGeneration,
                      "Policy generation advanced.",
                    )
                  }
                >
                  Advance
                </Button>
              }
            >
              <div className="pb-3.5">
                <FactRows rows={nodePolicyRows(snapshot.policy)} />
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Fallback">
            {fallback === null ? (
              <SettingsRow title="Fallback" description="Waiting for the node." />
            ) : fallback.quiet ? (
              <SettingsRow
                title="Nothing has fallen back"
                description={NODE_FALLBACK_QUIET}
                control={<ResetFallbackButton busy={busy} onConfirm={confirmThen} />}
              />
            ) : (
              <>
                {fallback.classes.map((entry) => (
                  <SettingsRow
                    key={entry.label}
                    title={entry.label}
                    description={entry.meaning}
                    status={`Last ${entry.lastOccurrence}${entry.ringOverflows > 0 ? ` · ${entry.ringOverflows} overflow(s)` : ""}`}
                    control={
                      <span className="font-mono text-sm font-semibold">{entry.occurrences}</span>
                    }
                  />
                ))}
                <SettingsRow
                  title="Retained occurrences"
                  description={
                    fallback.overflowNotice ??
                    `Observation window started ${fallback.windowStarted}.`
                  }
                  control={<ResetFallbackButton busy={busy} onConfirm={confirmThen} />}
                >
                  <ul className="space-y-1 pb-3.5">
                    {fallback.entries.map((entry) => (
                      <li
                        key={entry.ordinal}
                        className="font-mono text-[11px] text-muted-foreground"
                      >
                        {entry.at} · {entry.reason}
                      </li>
                    ))}
                  </ul>
                </SettingsRow>
                {fallback.undersizedNotice ? (
                  <SettingsRow
                    title="Undersized connection"
                    description={fallback.undersizedNotice}
                  />
                ) : null}
              </>
            )}
          </SettingsSection>
        </>
      )}

      {/* §12.6's warning, between the preview and the change. */}
      <AlertDialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply this policy change?</AlertDialogTitle>
            <AlertDialogDescription>
              {preview?.warnings.length === 0
                ? "The node reports that this closes no live channels."
                : preview?.warnings.map((warning) => (
                    <span key={warning} className="block pb-2">
                      {warning}
                    </span>
                  ))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>Leave it</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void applyPreviewedPolicy()}
            >
              Apply
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{activeConfirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{activeConfirmation?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>Cancel</AlertDialogClose>
            <Button
              variant={activeConfirmation?.destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={() => {
                const pending = confirmation;
                setConfirmation(null);
                if (pending) void pending.run();
              }}
            >
              {activeConfirmation?.confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsPageContainer>
  );
}

/**
 * §12.4's control — THE ONE THE HARD BLOCK IS ON — as a single component both
 * modes render.
 *
 * IT WAS TWO CONTROLS AND THAT WAS THE DEFECT. The hosted branch drew its own
 * `<Switch disabled />` with the attribute written by hand, so the block it
 * demonstrated was a literal rather than a consequence of
 * {@link nodeE2eeStrictPolicyDisposition}: deleting the disposition from the
 * local branch left the hosted one disabled anyway, and a suite asserting the
 * hosted control is inert passed while the guard it was supposed to be checking
 * had gone. One component, one `disabled` expression, derived from the
 * disposition — so the assertion and the guard are the same thing.
 *
 * The reason travels as the description rather than as a tooltip: a control an
 * operator cannot use and cannot find out why about is one they will go looking
 * for a way around.
 */
function StrictPolicyRow({
  disposition,
  checked,
  busy,
  onChange,
}: {
  readonly disposition: NodeE2eeStrictPolicyDisposition;
  readonly checked: boolean;
  readonly busy: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const blocked = disposition.kind === "blocked";
  return (
    <SettingsRow
      title="Only approved native client keys"
      description={
        disposition.kind === "blocked"
          ? disposition.reason
          : "Closes browser and legacy access entirely. Only approved native client keys reach application payload."
      }
      control={
        <Switch
          checked={checked}
          disabled={blocked || busy}
          aria-label="Require approved client E2EE"
          data-testid="require-approved-client-e2ee"
          data-blocked={blocked ? "hosted" : undefined}
          onCheckedChange={onChange}
        />
      }
    />
  );
}

function ResetFallbackButton({
  busy,
  onConfirm,
}: {
  readonly busy: boolean;
  readonly onConfirm: (
    action: NodeE2eeActionId,
    operation: () => Promise<unknown>,
    message: string,
  ) => void;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={busy}
      onClick={() => onConfirm("reset-fallback", resetNodeE2eeFallback, "Fallback counters reset.")}
    >
      Reset
    </Button>
  );
}

function ClientRecordRow({
  record,
  busy,
  onAuthorize,
  onApprove,
}: {
  readonly record: NodeE2eeClientRecord;
  readonly busy: boolean;
  readonly onAuthorize: (
    request: NodeE2eeAuthorizationRequest,
    action: NodeE2eeActionId,
    message: string,
  ) => void;
  readonly onApprove: (request: NodeE2eeAuthorizationRequest, role: NodeE2eeApprovableRole) => void;
}) {
  const key = {
    hubOrigin: record.hubOrigin,
    accountId: record.accountId,
    fingerprint: record.fingerprint,
  };
  const tone = nodeClientStatusTone(record.status);

  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          {record.displayLabel ?? "Client key"}
          <Badge size="sm" variant={tone === "success" ? "success" : tone}>
            {record.status}
          </Badge>
        </span>
      }
      description={`${record.accountId} at ${record.hubOrigin}`}
      control={
        <>
          {/* §13.6: an approval names the maximum role, and the OWNER names it.
              One button per role rather than one button and a default, because a
              default is the panel choosing the ceiling every channel this key
              opens is admitted under. Least authority first. */}
          {record.status === "approved"
            ? null
            : NODE_E2EE_APPROVABLE_ROLES.map((role) => (
                <Button
                  key={role}
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    onApprove({ ...key, action: "approve", maxRole: role, capabilitySet: [] }, role)
                  }
                >
                  Approve as {role}
                </Button>
              ))}
          {record.status === "approved" ? (
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={busy}
              onClick={() =>
                onAuthorize(
                  { ...key, action: "narrow", maxRole: "viewer" },
                  "narrow",
                  "Authority reduced.",
                )
              }
            >
              Reduce to viewer
            </Button>
          ) : null}
          {record.status === "revoked" ? null : (
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={busy}
              onClick={() => onAuthorize({ ...key, action: "revoke" }, "revoke", "Client revoked.")}
            >
              Revoke
            </Button>
          )}
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={busy}
            onClick={() => onAuthorize({ ...key, action: "purge" }, "purge", "Record deleted.")}
          >
            Delete
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-3.5">
        <FactRows rows={nodeClientRows(record)} />
        <SafetyNumber value={record.safetyNumber} />
      </div>
    </SettingsRow>
  );
}

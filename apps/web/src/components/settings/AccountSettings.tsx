// Hosted account settings: passkeys, two-factor, password, email, and recovery
// codes, driven entirely by `hostedHubController` and the two runtime stores.
//
// Three rules shape this file, and none of them is cosmetic:
//
//   1. **Step-up is discovered, never assumed.** Nothing here can tell whether
//      the current session was minted from a passkey or from a fallback
//      credential — neither the client session nor the Hub says. So an action is
//      attempted, and a TOTP field appears only after the Hub has refused it
//      with the step-up gate. A field rendered up front would be a guess, and a
//      wrong one for every passkey session.
//   2. **Secret material is transient.** Recovery codes and the TOTP enrolment
//      secret live in one in-memory runtime slot each. This surface renders them,
//      never copies them into its own state, never puts them in a URL or a log,
//      and drops them on dismissal and on teardown.
//   3. **A fallback is never dressed up as a passkey.** Password, recovery code,
//      and emailed link are the weaker ways in, and the copy says so.

import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  MailIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserRoundIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import type { HostedHubPasskey } from "@ryco/client-runtime/authorization";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import {
  hostedAccountStore,
  hostedHubController,
  useHostedAccountStore,
  useHostedHubStore,
} from "../../hostedHub/state";
import { useRecoveryCodeDisplayStore } from "../../hostedHub/recoveryCodeDisplay";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { QRCodeSvg } from "../ui/qr-code";
import { Spinner } from "../ui/spinner";
import {
  activePasskeys,
  emailIssue,
  EMAIL_MAX_LENGTH,
  inlineErrorMessage,
  isPasskeyRevoked,
  isPasskeySessionRequired,
  isStepUpRequired,
  formatRecoveryCodesForClipboard,
  normalizePasskeyLabel,
  normalizeTotpCode,
  passkeyBackupSummary,
  passkeyDisplayLabel,
  passwordIssue,
  PASSWORD_MAX_LENGTH,
  isSubmittableTotpCode,
  stepUpDescription,
  stepUpTitle,
  TOTP_CODE_MAX_LENGTH,
  type AccountStepUpAction,
} from "./AccountSettings.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatEpoch(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return timestampFormatter.format(new Date(value));
}

/**
 * A step-up the Hub asked for: the action's identity (for the prompt copy) and
 * the caller's own thunk, re-run verbatim with the code the user supplies.
 * Re-running the caller's thunk rather than reconstructing the request keeps the
 * retry identical to the attempt — including the password or email address the
 * user already typed, which never has to be round-tripped through this state.
 */
interface PendingStepUp {
  readonly action: AccountStepUpAction;
  readonly run: (stepUp: { readonly totpCode?: string }) => Promise<void>;
  readonly onCommitted: (() => void) | undefined;
}

/**
 * Run an account action, and escalate to a step-up prompt if the Hub says the
 * session needs one.
 *
 * The runtime publishes an action's outcome on `hostedAccountStore` rather than
 * by rejecting, so the store is the authority on what happened; it is read
 * after the await, when exactly one action has run.
 *
 * `onCommitted` fires on exactly one of the two paths that can succeed — the
 * first attempt, or the retry that carried a code — so a caller's cleanup (a
 * typed password cleared, a form closed) cannot be skipped just because the
 * session turned out to need a step-up.
 */
function useAccountAction() {
  const [stepUp, setStepUp] = useState<PendingStepUp | null>(null);
  const [stepUpAttempts, setStepUpAttempts] = useState(0);
  const [stepUpCode, setStepUpCode] = useState("");

  const closeStepUp = useCallback(() => {
    setStepUp(null);
    setStepUpAttempts(0);
    setStepUpCode("");
  }, []);

  const run = useCallback(
    async (
      action: AccountStepUpAction,
      thunk: (input: { readonly totpCode?: string }) => Promise<void>,
      onCommitted?: () => void,
    ): Promise<void> => {
      await thunk({});
      const error = hostedAccountStore.getState().errorMessage;
      if (isStepUpRequired(error)) {
        setStepUpCode("");
        setStepUpAttempts(0);
        setStepUp({ action, run: thunk, onCommitted });
        return;
      }
      if (error === null) onCommitted?.();
    },
    [],
  );

  const submitStepUp = useCallback(async () => {
    if (!stepUp) return;
    const totpCode = normalizeTotpCode(stepUpCode);
    if (totpCode.length === 0) return;
    await stepUp.run({ totpCode });
    const error = hostedAccountStore.getState().errorMessage;
    if (isStepUpRequired(error)) {
      setStepUpAttempts((attempts) => attempts + 1);
      setStepUpCode("");
      return;
    }
    if (error === null) stepUp.onCommitted?.();
    closeStepUp();
  }, [closeStepUp, stepUp, stepUpCode]);

  return {
    run,
    stepUp,
    stepUpAttempts,
    stepUpCode,
    setStepUpCode,
    submitStepUp,
    closeStepUp,
  };
}

/** A busy control: the label with a spinner while this action is the live one. */
function ActionLabel({ busy, children }: { readonly busy: boolean; readonly children: ReactNode }) {
  return busy ? (
    <>
      <Spinner className="size-3.5" />
      {children}
    </>
  ) : (
    <>{children}</>
  );
}

export function AccountSettingsPanel() {
  const accountStatus = useHostedHubStore((state) => state.accountStatus);
  const account = useHostedHubStore((state) => state.account);
  const passkeys = useHostedAccountStore((state) => state.passkeys);
  const passkeysStatus = useHostedAccountStore((state) => state.passkeysStatus);
  const actionStatus = useHostedAccountStore((state) => state.actionStatus);
  const errorMessage = useHostedAccountStore((state) => state.errorMessage);
  const recoveryCodes = useHostedHubStore((state) => state.recoveryCodes);
  const totpEnrollment = useHostedHubStore((state) => state.totpEnrollment ?? null);
  const claimRecoveryCodeDisplay = useRecoveryCodeDisplayStore((state) => state.claim);
  const releaseRecoveryCodeDisplay = useRecoveryCodeDisplayStore((state) => state.release);

  const action = useAccountAction();
  const busy = actionStatus !== "idle";

  useEffect(() => {
    void hostedHubController.refreshPasskeys();
  }, []);

  /**
   * While this surface is mounted it owns the one-time recovery-code display,
   * and on teardown it drops **both** secrets the runtime can be holding on its
   * behalf. Closing the settings surface with codes or an enrolment secret still
   * in the slot would leave the account's key material resident for the life of
   * the session — and, for recovery codes, would hand the display back to the
   * hosted root, which would take over the whole viewport.
   */
  useEffect(() => {
    claimRecoveryCodeDisplay();
    return () => {
      releaseRecoveryCodeDisplay();
      hostedHubController.dismissRecoveryCodes();
      hostedHubController.dismissTotpEnrollment();
    };
  }, [claimRecoveryCodeDisplay, releaseRecoveryCodeDisplay]);

  if (accountStatus !== "authenticated") {
    return (
      <SettingsPageContainer>
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>Not signed in</AlertTitle>
          <AlertDescription>
            Sign in to the Hub to manage passkeys, two-factor authentication, and recovery codes.
          </AlertDescription>
        </Alert>
      </SettingsPageContainer>
    );
  }

  const inlineError = inlineErrorMessage(errorMessage, action.stepUp !== null);

  return (
    <SettingsPageContainer>
      {inlineError ? (
        <Alert
          variant={isPasskeySessionRequired(inlineError) ? "info" : "error"}
          aria-live="polite"
        >
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>
            {isPasskeySessionRequired(inlineError) ? "Passkey needed" : "That did not work"}
          </AlertTitle>
          <AlertDescription>{inlineError}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsSection title="Account" icon={<UserRoundIcon aria-hidden className="size-3.5" />}>
        <SettingsRow
          title={account?.displayName ?? "Signed in"}
          description="The Hub account these credentials belong to."
          status={
            account
              ? `${account.role} · joined ${formatEpoch(account.createdAt) ?? "unknown"}`
              : null
          }
        />
      </SettingsSection>

      <PasskeysSection
        passkeys={passkeys}
        loading={passkeysStatus === "loading"}
        stale={passkeysStatus === "stale"}
        busy={busy}
        actionStatus={actionStatus}
        run={action.run}
      />

      <TwoFactorSection
        busy={busy}
        actionStatus={actionStatus}
        enrollment={totpEnrollment}
        run={action.run}
      />

      <PasswordSection busy={busy} actionStatus={actionStatus} run={action.run} />

      <EmailSection busy={busy} actionStatus={actionStatus} run={action.run} />

      <RecoveryCodesSection
        busy={busy}
        actionStatus={actionStatus}
        recoveryCodes={recoveryCodes}
        run={action.run}
      />

      <StepUpDialog
        pending={action.stepUp}
        attempts={action.stepUpAttempts}
        code={action.stepUpCode}
        onCodeChange={action.setStepUpCode}
        onSubmit={action.submitStepUp}
        onCancel={action.closeStepUp}
        busy={busy}
      />
    </SettingsPageContainer>
  );
}

type RunAccountAction = (
  action: AccountStepUpAction,
  thunk: (input: { readonly totpCode?: string }) => Promise<void>,
  onCommitted?: () => void,
) => Promise<void>;

/* ------------------------------------------------------------------ passkeys */

function PasskeysSection({
  passkeys,
  loading,
  stale,
  busy,
  actionStatus,
  run,
}: {
  readonly passkeys: ReadonlyArray<HostedHubPasskey>;
  readonly loading: boolean;
  readonly stale: boolean;
  readonly busy: boolean;
  readonly actionStatus: string;
  readonly run: RunAccountAction;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<HostedHubPasskey | null>(null);
  const adding = actionStatus === "adding-passkey";
  const revoking = actionStatus === "revoking-passkey";
  const active = activePasskeys(passkeys);

  const submitAdd = async (event: FormEvent) => {
    event.preventDefault();
    const passkeyLabel = normalizePasskeyLabel(label);
    await run(
      "add-passkey",
      (stepUp) => hostedHubController.addPasskey({ passkeyLabel, ...stepUp }),
      () => {
        setLabel("");
        setAddOpen(false);
      },
    );
  };

  const confirmRevoke = async () => {
    const target = pendingRevoke;
    if (!target) return;
    setPendingRevoke(null);
    await hostedHubController.revokePasskey(target.id);
  };

  return (
    <SettingsSection
      title="Passkeys"
      icon={<KeyRoundIcon aria-hidden className="size-3.5" />}
      headerAction={
        <Button size="xs" variant="outline" disabled={busy} onClick={() => setAddOpen(true)}>
          Add passkey
        </Button>
      }
    >
      <SettingsRow
        title="Passkeys on this account"
        description="A passkey is the strongest way in. Add one for every device you sign in from, and keep at least two so losing a device does not lock you out."
        status={
          stale
            ? "This list could not be refreshed and may be out of date."
            : `${String(active.length)} usable ${active.length === 1 ? "passkey" : "passkeys"}`
        }
      />
      {loading && passkeys.length === 0 ? (
        <SettingsRow title="Loading passkeys…" description="Reading the credentials on file." />
      ) : null}
      {!loading && passkeys.length === 0 ? (
        <SettingsRow
          title="No passkeys yet"
          description="Add one now — without a passkey you can only get back in through a fallback credential."
        />
      ) : null}
      {passkeys.map((passkey) => {
        const revoked = isPasskeyRevoked(passkey);
        const backup = passkeyBackupSummary(passkey);
        const created = formatEpoch(passkey.createdAt);
        const lastUsed = formatEpoch(passkey.lastUsedAt);
        return (
          <SettingsRow
            key={passkey.id}
            title={
              <span className="flex items-center gap-2">
                {passkeyDisplayLabel(passkey)}
                {revoked ? (
                  <Badge variant="error" size="sm">
                    Revoked
                  </Badge>
                ) : null}
              </span>
            }
            description={
              revoked
                ? `Revoked${passkey.revocationReasonCode ? ` — ${passkey.revocationReasonCode}` : ""}. This credential can no longer sign in.`
                : (backup ?? "The Hub did not report whether this credential is backed up.")
            }
            status={[
              created ? `Added ${created}` : null,
              lastUsed ? `Last used ${lastUsed}` : "Never used",
            ]
              .filter((part): part is string => part !== null)
              .join(" · ")}
            control={
              revoked ? null : (
                <Button
                  size="xs"
                  variant="destructive-outline"
                  aria-label={`Revoke ${passkeyDisplayLabel(passkey)}`}
                  disabled={busy}
                  onClick={() => setPendingRevoke(passkey)}
                >
                  <ActionLabel busy={revoking && pendingRevoke?.id === passkey.id}>
                    <Trash2Icon aria-hidden />
                    Revoke
                  </ActionLabel>
                </Button>
              )
            }
          />
        );
      })}

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setAddOpen(open);
        }}
      >
        <DialogPopup className="max-w-md">
          <form onSubmit={(event) => void submitAdd(event)}>
            <DialogHeader>
              <DialogTitle>Add a passkey</DialogTitle>
              <DialogDescription>
                Your browser will ask you to create a passkey for this account. Adding one replaces
                the current Hub session with a fresh one.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-3">
              <Label htmlFor="account-passkey-label">Name (optional)</Label>
              <Input
                id="account-passkey-label"
                value={label}
                autoComplete="off"
                placeholder="Work laptop"
                disabled={adding}
                onChange={(event) => setLabel(event.target.value)}
              />
            </DialogPanel>
            <DialogFooter>
              {adding ? (
                <Button variant="outline" onClick={() => hostedHubController.cancelAccountAction()}>
                  Cancel
                </Button>
              ) : (
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              )}
              <Button type="submit" disabled={busy}>
                <ActionLabel busy={adding}>Create passkey</ActionLabel>
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (busy) return;
          if (!open) setPendingRevoke(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this passkey?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRevoke ? passkeyDisplayLabel(pendingRevoke) : ""} will stop working
              immediately, on every device it is stored on. This cannot be undone — you would have
              to enrol the device again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep it</AlertDialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmRevoke()}>
              Revoke passkey
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}

/* ---------------------------------------------------------------- two-factor */

function TwoFactorSection({
  busy,
  actionStatus,
  enrollment,
  run,
}: {
  readonly busy: boolean;
  readonly actionStatus: string;
  readonly enrollment: { readonly secretBase32: string; readonly provisioningUri: string } | null;
  readonly run: RunAccountAction;
}) {
  const [code, setCode] = useState("");
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);
  const enrolling = actionStatus === "enrolling-totp";
  const confirming = actionStatus === "confirming-totp";
  const revoking = actionStatus === "revoking-totp";

  const dismissEnrollment = useCallback(() => {
    setCode("");
    hostedHubController.dismissTotpEnrollment();
  }, []);

  const submitConfirm = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeTotpCode(code);
    if (normalized.length === 0) return;
    await hostedHubController.confirmTotpEnrollment({ code: normalized });
    // The runtime drops the secret on a confirmed enrolment; clear the typed
    // code either way so a rejected attempt does not leave it in a field.
    setCode("");
  };

  const confirmRevoke = async () => {
    setConfirmRevokeOpen(false);
    await run("revoke-totp", (stepUp) => hostedHubController.revokeTotp(stepUp));
  };

  return (
    <SettingsSection
      title="Two-factor authentication"
      icon={<ShieldCheckIcon aria-hidden className="size-3.5" />}
    >
      <SettingsRow
        title="Authenticator app"
        description="A six-digit code from an authenticator app, required whenever you change credentials from a session that was not started with a passkey. Signing in with a passkey never asks for one."
        status="This Hub does not report whether an authenticator is already enrolled — setting one up when one exists will be refused."
        control={
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => void hostedHubController.beginTotpEnrollment()}
          >
            <ActionLabel busy={enrolling}>Set up</ActionLabel>
          </Button>
        }
      />
      <SettingsRow
        title="Remove two-factor authentication"
        description="Stops the Hub asking for a code and leaves fallback sign-ins protected by the credential alone."
        control={
          <Button
            size="xs"
            variant="destructive-outline"
            aria-label="Turn off two-factor authentication"
            disabled={busy}
            onClick={() => setConfirmRevokeOpen(true)}
          >
            <ActionLabel busy={revoking}>Remove</ActionLabel>
          </Button>
        }
      />

      <Dialog
        open={enrollment !== null}
        onOpenChange={(open) => {
          if (!open) dismissEnrollment();
        }}
      >
        <DialogPopup className="max-w-md">
          <form onSubmit={(event) => void submitConfirm(event)}>
            <DialogHeader>
              <DialogTitle>Set up two-factor authentication</DialogTitle>
              <DialogDescription>
                Scan this with your authenticator app, then enter the code it shows. This is the
                only time the key is displayed.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              {enrollment ? (
                <>
                  <div className="flex justify-center rounded-xl border border-border bg-white p-4">
                    <QRCodeSvg
                      value={enrollment.provisioningUri}
                      size={168}
                      level="M"
                      marginSize={1}
                      title="Two-factor setup code"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Can&apos;t scan? Enter this key manually:
                    </p>
                    <p
                      aria-label="Two-factor setup key"
                      className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm break-all"
                    >
                      {enrollment.secretBase32}
                    </p>
                  </div>
                </>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="account-totp-confirm">Code from your app</Label>
                <Input
                  id="account-totp-confirm"
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={TOTP_CODE_MAX_LENGTH}
                  disabled={confirming}
                  onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
                />
              </div>
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" onClick={dismissEnrollment}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !isSubmittableTotpCode(code)}>
                <ActionLabel busy={confirming}>Turn on</ActionLabel>
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={confirmRevokeOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setConfirmRevokeOpen(open);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove two-factor authentication?</AlertDialogTitle>
            <AlertDialogDescription>
              Password, recovery-code, and emailed-link sign-ins will no longer need a code from
              your authenticator app. You can set it up again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep it on</AlertDialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmRevoke()}>
              Remove two-factor
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ password */

function PasswordSection({
  busy,
  actionStatus,
  run,
}: {
  readonly busy: boolean;
  readonly actionStatus: string;
  readonly run: RunAccountAction;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const setting = actionStatus === "setting-password";
  const removing = actionStatus === "removing-password";
  const issue = passwordIssue(password, confirmation);

  const clear = useCallback(() => {
    setPassword("");
    setConfirmation("");
    setTouched(false);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (issue) return;
    await run(
      "set-password",
      (stepUp) => hostedHubController.setPassword({ password, ...stepUp }),
      () => {
        clear();
        setOpen(false);
      },
    );
  };

  const confirmRemove = async () => {
    setConfirmRemoveOpen(false);
    await run("remove-password", (stepUp) => hostedHubController.removePassword(stepUp));
  };

  return (
    <SettingsSection title="Password" icon={<KeyRoundIcon aria-hidden className="size-3.5" />}>
      <SettingsRow
        title="Fallback password"
        description="A password is a fallback, not an equal of a passkey: it can be phished and reused, and a session started with one has to prove itself again before changing credentials. Keep a passkey as your normal way in."
        control={
          <Button size="xs" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
            <ActionLabel busy={setting}>Set or change</ActionLabel>
          </Button>
        }
      />
      <SettingsRow
        title="Remove the password"
        description="Leaves your passkeys and recovery codes in place and removes the weakest way in."
        control={
          <Button
            size="xs"
            variant="destructive-outline"
            aria-label="Delete the fallback password"
            disabled={busy}
            onClick={() => setConfirmRemoveOpen(true)}
          >
            <ActionLabel busy={removing}>Remove</ActionLabel>
          </Button>
        }
      />

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          // The typed password is never carried across a dismissal.
          if (!next) clear();
        }}
      >
        <DialogPopup className="max-w-md">
          <form onSubmit={(event) => void submit(event)}>
            <DialogHeader>
              <DialogTitle>Set a fallback password</DialogTitle>
              <DialogDescription>
                This replaces any password already on the account. The Hub rejects passwords that
                have appeared in a known breach.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="account-password">New password</Label>
                <Input
                  id="account-password"
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  maxLength={PASSWORD_MAX_LENGTH}
                  disabled={setting}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-password-confirm">Confirm password</Label>
                <Input
                  id="account-password-confirm"
                  type="password"
                  value={confirmation}
                  autoComplete="new-password"
                  maxLength={PASSWORD_MAX_LENGTH}
                  disabled={setting}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </div>
              {touched && issue ? (
                <p role="alert" className="text-xs text-destructive-foreground">
                  {issue}
                </p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={busy}>
                <ActionLabel busy={setting}>Save password</ActionLabel>
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={confirmRemoveOpen}
        onOpenChange={(next) => {
          if (busy) return;
          setConfirmRemoveOpen(next);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the password?</AlertDialogTitle>
            <AlertDialogDescription>
              You will no longer be able to sign in with a password. Make sure you still have a
              passkey, or recovery codes you have saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep it</AlertDialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmRemove()}>
              Remove password
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}

/* --------------------------------------------------------------------- email */

function EmailSection({
  busy,
  actionStatus,
  run,
}: {
  readonly busy: boolean;
  readonly actionStatus: string;
  readonly run: RunAccountAction;
}) {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const requesting = actionStatus === "requesting-email-verification";
  const issue = emailIssue(email);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setAccepted(false);
    if (issue) return;
    await run(
      "request-email-verification",
      (stepUp) => hostedHubController.requestEmailVerification({ email: email.trim(), ...stepUp }),
      () => setAccepted(true),
    );
  };

  return (
    <SettingsSection title="Email" icon={<MailIcon aria-hidden className="size-3.5" />}>
      <div className="px-4 pt-3.5 sm:px-5">
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>No mail will arrive yet</AlertTitle>
          <AlertDescription>
            This Hub has no mail transport configured, so verification messages are generated and
            discarded. The request below will be accepted and nothing will be delivered until an
            operator wires one up. Do not rely on email as your way back into the account.
          </AlertDescription>
        </Alert>
      </div>
      <SettingsRow
        title="Verify an email address"
        description="Used for account recovery once mail delivery is switched on. The Hub answers the same way whether or not the address is already known, so this never confirms who owns it."
      >
        <form className="pt-3 pb-3.5" onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Email address"
              type="email"
              value={email}
              autoComplete="email"
              placeholder="you@example.com"
              maxLength={EMAIL_MAX_LENGTH}
              disabled={requesting}
              onChange={(event) => {
                setEmail(event.target.value);
                setAccepted(false);
              }}
            />
            <Button type="submit" size="sm" variant="outline" disabled={busy} className="shrink-0">
              <ActionLabel busy={requesting}>Send verification</ActionLabel>
            </Button>
          </div>
          {touched && issue ? (
            <p role="alert" className="pt-2 text-xs text-destructive-foreground">
              {issue}
            </p>
          ) : null}
          {accepted ? (
            <p role="status" className="pt-2 text-xs text-muted-foreground">
              Request accepted by the Hub. No message will be delivered until a mail transport is
              configured.
            </p>
          ) : null}
        </form>
      </SettingsRow>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------ recovery codes */

function RecoveryCodesSection({
  busy,
  actionStatus,
  recoveryCodes,
  run,
}: {
  readonly busy: boolean;
  readonly actionStatus: string;
  readonly recoveryCodes: ReadonlyArray<string>;
  readonly run: RunAccountAction;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const regenerating = actionStatus === "regenerating-recovery-codes";
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  /**
   * Regeneration is a rotation: it mints a new set and invalidates every code
   * the user has already written down. It runs from this confirmed handler and
   * from nowhere else — never on mount, focus, retry, or reconnect.
   */
  const confirmRegenerate = async () => {
    setConfirmOpen(false);
    await run("regenerate-recovery-codes", (stepUp) =>
      hostedHubController.regenerateRecoveryCodes(stepUp),
    );
  };

  return (
    <SettingsSection
      title="Recovery codes"
      icon={<RefreshCwIcon aria-hidden className="size-3.5" />}
    >
      <SettingsRow
        title="One-time recovery codes"
        description="Single-use codes that get you back in when you have lost every passkey. They are a last resort, not a substitute for one — anyone holding a code can sign in as you."
        status="Ryco shows them once and never writes them to browser storage."
        control={
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            <ActionLabel busy={regenerating}>Generate new codes</ActionLabel>
          </Button>
        }
      />

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setConfirmOpen(open);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your recovery codes?</AlertDialogTitle>
            <AlertDialogDescription>
              Every code you have already saved stops working immediately. You will get a new set,
              shown once — if you lose them you will have to generate another set from a session you
              can still sign in to.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmRegenerate()}>
              Replace codes
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <Dialog
        open={recoveryCodes.length > 0}
        onOpenChange={(open) => {
          // Dismissal is the only exit, and it drops the codes from the runtime
          // slot rather than merely hiding them.
          if (!open) hostedHubController.dismissRecoveryCodes();
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save your recovery codes</DialogTitle>
            <DialogDescription>
              These are shown once and cannot be retrieved later. Store them somewhere only you can
              reach — a password manager, or paper somewhere safe.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <ul
              aria-label="Recovery codes"
              className="grid gap-2 rounded-xl border border-border bg-background p-4 font-mono text-sm sm:grid-cols-2"
            >
              {recoveryCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                copyToClipboard(formatRecoveryCodesForClipboard(recoveryCodes), undefined)
              }
            >
              {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              {isCopied ? "Copied" : "Copy codes"}
            </Button>
            <Button onClick={() => hostedHubController.dismissRecoveryCodes()}>
              I saved the codes
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------- step-up */

function StepUpDialog({
  pending,
  attempts,
  code,
  onCodeChange,
  onSubmit,
  onCancel,
  busy,
}: {
  readonly pending: PendingStepUp | null;
  readonly attempts: number;
  readonly code: string;
  readonly onCodeChange: (value: string) => void;
  readonly onSubmit: () => Promise<void>;
  readonly onCancel: () => void;
  readonly busy: boolean;
}) {
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (busy) return;
        if (!open) onCancel();
      }}
    >
      <DialogPopup className="max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{pending ? stepUpTitle(pending.action) : ""}</DialogTitle>
            <DialogDescription>{stepUpDescription(attempts)}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-2">
            <Label htmlFor="account-step-up-code">Authenticator code</Label>
            <Input
              id="account-step-up-code"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={TOTP_CODE_MAX_LENGTH}
              disabled={busy}
              onChange={(event) => onCodeChange(normalizeTotpCode(event.target.value))}
            />
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !isSubmittableTotpCode(code)}>
              <ActionLabel busy={busy}>Confirm code</ActionLabel>
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

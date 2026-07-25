// Pure logic for the hosted account settings surface.
//
// Everything here is deliberately free of React and of the runtime stores so it
// can be exercised directly: the step-up classification, the passkey
// presentation rules, and the input normalisation are the parts whose failure
// modes are security-relevant rather than cosmetic.

import {
  HostedHubApiError,
  HOSTED_PASSKEY_UNCONFIRMED_MESSAGE,
  PASSKEY_SESSION_REQUIRED_CODE,
  STEP_UP_REQUIRED_CODE,
  type HostedHubPasskey,
} from "@ryco/client-runtime/authorization";

/**
 * The runtime's account actions report failures as a *message* on
 * `hostedAccountStore.errorMessage` — the `HostedHubApiError.code` that produced
 * it is not carried onto the store. The two codes this surface has to branch on
 * are therefore recognised by round-tripping them through the runtime's own
 * error constructor rather than by restating its copy here: if the runtime
 * rewords either message, these constants follow it, and a reworded message can
 * never silently stop matching.
 */
export const STEP_UP_REQUIRED_MESSAGE = new HostedHubApiError(STEP_UP_REQUIRED_CODE, 403).message;

/** The mirror of {@link STEP_UP_REQUIRED_MESSAGE} for the passkey-session gate. */
export const PASSKEY_SESSION_REQUIRED_MESSAGE = new HostedHubApiError(
  PASSKEY_SESSION_REQUIRED_CODE,
  403,
).message;

/**
 * Whether the last account action failed on the fallback-session step-up gate.
 *
 * This is the only signal a client has. Neither the client session nor the Hub
 * exposes which credential minted the session, so a surface cannot know in
 * advance whether an action needs a TOTP code — it attempts the action and asks
 * only once the Hub has said it must.
 */
export function isStepUpRequired(errorMessage: string | null | undefined): boolean {
  return errorMessage === STEP_UP_REQUIRED_MESSAGE;
}

/**
 * Whether the last account action was refused because it requires a
 * passkey-authenticated session. There is no step-up out of this one: a
 * fallback session cannot enrol TOTP at all, and offering a code field here
 * would imply otherwise.
 */
export function isPasskeySessionRequired(errorMessage: string | null | undefined): boolean {
  return errorMessage === PASSKEY_SESSION_REQUIRED_MESSAGE;
}

/**
 * The error worth rendering in the section body.
 *
 * A step-up refusal is not a failure the user needs to read as one — it is the
 * prompt the surface is already showing — so it is withheld while the step-up
 * dialog carries the same information in an actionable form.
 */
export function inlineErrorMessage(
  errorMessage: string | null,
  stepUpPending: boolean,
): string | null {
  if (!errorMessage) return null;
  if (stepUpPending && isStepUpRequired(errorMessage)) return null;
  return errorMessage;
}

/**
 * Whether an error published by an add-passkey attempt arrived *after* the
 * credential was committed, and so is not evidence the ceremony failed.
 *
 * `addPasskey` does not trust the ceremony: once the Hub has accepted it, the
 * runtime issues a forced re-read and confirms the credential is on the list.
 * That read publishes its own failure on the same `errorMessage` slot the
 * ceremony's failure uses, so "there is an error" cannot mean "nothing was
 * enrolled". Two shapes are post-commit:
 *
 *   * the confirming read failed, leaving the list `stale`; or
 *   * the read succeeded and did not contain the credential, which the runtime
 *     reports with its own bounded message.
 *
 * A pre-commit failure never reaches that read and so cannot leave the list
 * stale — with one exception: a list already stale from an earlier read is
 * still stale afterwards. That case is answered the same way, because the two
 * mistakes do not cost the same. Closing the dialog on a ceremony that really
 * did fail costs one extra click; re-offering "Create passkey" on one that
 * succeeded runs a second ceremony and leaves a duplicate credential on the
 * account, which is the failure this exists to prevent.
 */
export function isPasskeyEnrolmentUnverified(
  errorMessage: string,
  passkeysStatus: string,
): boolean {
  if (isStepUpRequired(errorMessage)) return false;
  if (errorMessage === HOSTED_PASSKEY_UNCONFIRMED_MESSAGE) return true;
  return passkeysStatus === "stale";
}

/** A passkey is revoked once the Hub reports a revocation timestamp for it. */
export function isPasskeyRevoked(passkey: HostedHubPasskey): boolean {
  return passkey.revokedAt !== null;
}

/** The credentials that can still authenticate. */
export function activePasskeys(
  passkeys: ReadonlyArray<HostedHubPasskey>,
): ReadonlyArray<HostedHubPasskey> {
  return passkeys.filter((passkey) => !isPasskeyRevoked(passkey));
}

/**
 * A display name for a credential the Hub did not label. The credential id is a
 * public handle, so showing a truncated form of it is safe and is the only
 * thing that distinguishes two unlabelled keys.
 */
export function passkeyDisplayLabel(passkey: HostedHubPasskey): string {
  const label = passkey.label?.trim();
  if (label) return label;
  return `Unnamed passkey (${passkey.id.slice(0, 12)}…)`;
}

/**
 * How a credential answers "will this survive losing the device?".
 *
 * `backupEligible` / `backupState` are independently nullable, and `null` means
 * the Hub did not say — which must not be rendered as "not backed up".
 */
export function passkeyBackupSummary(passkey: HostedHubPasskey): string | null {
  if (passkey.backupState === true) return "Synced to your password manager";
  if (passkey.backupEligible === true) return "Can be synced, not yet backed up";
  if (passkey.backupEligible === false) return "Tied to this device only";
  return null;
}

/**
 * Trim a label to what the Hub will accept, or `null` when the user left it
 * blank. The runtime omits a blank label rather than sending `""`, which the
 * Hub rejects; normalising here keeps the surface's own validation aligned.
 */
export function normalizePasskeyLabel(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** The Hub bounds a TOTP code at 16 characters; digits are the only content. */
export const TOTP_CODE_MAX_LENGTH = 16;

/**
 * Keep only digits, bounded. Authenticator apps render codes with a space in
 * the middle and users paste them that way, so stripping is a correctness fix
 * rather than a nicety.
 */
export function normalizeTotpCode(value: string): string {
  return value.replace(/\D/gu, "").slice(0, TOTP_CODE_MAX_LENGTH);
}

/** A TOTP code is submittable once it is a plausible length. */
export function isSubmittableTotpCode(value: string): boolean {
  return normalizeTotpCode(value).length >= 6;
}

/** The Hub bounds a password at 256 characters. */
export const PASSWORD_MAX_LENGTH = 256;

/** The Hub bounds an email address at 254 characters. */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Why a password pair cannot be submitted, or `null` when it can.
 *
 * Deliberately minimal: the Hub owns strength and breach policy (a breached
 * password comes back as a `conflict` with its own message), so restating a
 * strength rule here would be a second, weaker source of truth. What this does
 * own is the confirmation match, which never reaches the Hub at all.
 */
export function passwordIssue(password: string, confirmation: string): string | null {
  if (password.length === 0) return "Enter a password.";
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use ${String(PASSWORD_MAX_LENGTH)} characters or fewer.`;
  }
  if (confirmation.length === 0) return "Re-enter the password to confirm it.";
  if (password !== confirmation) return "The two passwords do not match.";
  return null;
}

/** Why an email address cannot be submitted, or `null` when it can. */
export function emailIssue(email: string): string | null {
  const trimmed = email.trim();
  if (trimmed.length === 0) return "Enter an email address.";
  if (trimmed.length > EMAIL_MAX_LENGTH) {
    return `Use ${String(EMAIL_MAX_LENGTH)} characters or fewer.`;
  }
  // Structural only. The Hub is the authority on deliverability, and a stricter
  // client pattern rejects addresses that are in fact valid.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed)) return "Enter a valid email address.";
  return null;
}

/** The clipboard form of a one-time recovery-code set: one code per line. */
export function formatRecoveryCodesForClipboard(codes: ReadonlyArray<string>): string {
  return codes.join("\n");
}

/**
 * Which account action a step-up prompt belongs to. Used only to word the
 * prompt; the retry itself re-runs the caller's own thunk.
 */
export type AccountStepUpAction =
  | "set-password"
  | "remove-password"
  | "revoke-totp"
  | "request-email-verification"
  | "add-passkey"
  | "regenerate-recovery-codes";

const STEP_UP_ACTION_TITLES: Record<AccountStepUpAction, string> = {
  "set-password": "Confirm the password change",
  "remove-password": "Confirm removing the password",
  "revoke-totp": "Confirm removing two-factor authentication",
  "request-email-verification": "Confirm the email change",
  "add-passkey": "Confirm adding a passkey",
  "regenerate-recovery-codes": "Confirm new recovery codes",
};

export function stepUpTitle(action: AccountStepUpAction): string {
  return STEP_UP_ACTION_TITLES[action];
}

/**
 * The prompt body. The second attempt cannot distinguish "no code" from "wrong
 * code" — the Hub answers both identically on purpose — so the retry copy says
 * only what is actually known, and points at the one cause the user can fix.
 */
export function stepUpDescription(attempts: number): string {
  return attempts === 0
    ? "This session was not started with a passkey, so this change needs a current code from your authenticator app."
    : "That code was not accepted. Codes change every 30 seconds — enter the one showing now.";
}

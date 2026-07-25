import { describe, expect, it } from "vite-plus/test";
import {
  HostedHubApiError,
  PASSKEY_SESSION_REQUIRED_CODE,
  STEP_UP_REQUIRED_CODE,
  type HostedAccountOutcome,
  type HostedAccountRefused,
  type HostedHubPasskey,
} from "@ryco/client-runtime/authorization";

import {
  activePasskeys,
  emailIssue,
  formatRecoveryCodesForClipboard,
  inlineErrorMessage,
  isPasskeyRevoked,
  isPasskeySessionRequired,
  isStepUpRefusal,
  isSubmittableTotpCode,
  normalizePasskeyLabel,
  normalizeTotpCode,
  passkeyBackupSummary,
  passkeyDisplayLabel,
  passwordIssue,
  shouldRetryStepUp,
  stepUpDescription,
  stepUpTitle,
  STEP_UP_INFERRED_ATTEMPT_LIMIT,
  TOTP_CODE_MAX_LENGTH,
} from "./AccountSettings.logic";

function passkey(overrides: Partial<HostedHubPasskey> = {}): HostedHubPasskey {
  return {
    id: "pkey_aaaaaaaaaaaaaaaaaaaaaa",
    label: "Work laptop",
    createdAt: 1_700_000_000_000,
    lastUsedAt: null,
    backupEligible: null,
    backupState: null,
    revokedAt: null,
    revocationReasonCode: null,
    ...overrides,
  };
}

function refused(overrides: Partial<HostedAccountRefused> = {}): HostedAccountRefused {
  return {
    status: "refused",
    reason: "request-failed",
    errorCode: null,
    wireErrorCode: null,
    inferredErrorCode: false,
    errorMessage: null,
    ...overrides,
  };
}

/** What the runtime hands back when it narrowed a bare `forbidden` on a step-up route. */
function inferredStepUpRefusal(): HostedAccountRefused {
  return refused({
    errorCode: STEP_UP_REQUIRED_CODE,
    wireErrorCode: "forbidden",
    inferredErrorCode: true,
    errorMessage: new HostedHubApiError(STEP_UP_REQUIRED_CODE, 403).message,
  });
}

describe("step-up classification", () => {
  it("branches on the code, not on the message the runtime happens to word", () => {
    // The message is display copy from the runtime's own error constructor and
    // may be reworded at any time; a surface that string-matched it would lose a
    // security branch to a copy edit.
    const reworded = refused({
      errorCode: STEP_UP_REQUIRED_CODE,
      wireErrorCode: "forbidden",
      inferredErrorCode: true,
      errorMessage: "Some entirely different wording.",
    });
    expect(isStepUpRefusal(reworded)).toBe(true);

    const impostor = refused({
      errorCode: "forbidden",
      wireErrorCode: "forbidden",
      errorMessage: new HostedHubApiError(STEP_UP_REQUIRED_CODE, 403).message,
    });
    expect(isStepUpRefusal(impostor), "the step-up message alone must not open a prompt").toBe(
      false,
    );
  });

  it("never mistakes another refusal for a step-up", () => {
    for (const code of [
      "conflict",
      "forbidden",
      "unauthorized",
      "rate_limited",
      "authentication_failed",
      "invalid_response",
      PASSKEY_SESSION_REQUIRED_CODE,
    ]) {
      expect(isStepUpRefusal(refused({ errorCode: code }))).toBe(false);
    }
    expect(isStepUpRefusal(refused())).toBe(false);
  });

  it("never reads a committed outcome as a refusal", () => {
    const committed: HostedAccountOutcome = { status: "committed" };
    expect(isStepUpRefusal(committed)).toBe(false);
  });

  it("recognises the passkey-session gate, which has no step-up out of it", () => {
    expect(isPasskeySessionRequired(PASSKEY_SESSION_REQUIRED_CODE)).toBe(true);
    expect(isPasskeySessionRequired(STEP_UP_REQUIRED_CODE)).toBe(false);
    expect(isPasskeySessionRequired("forbidden")).toBe(false);
    expect(isPasskeySessionRequired(null)).toBe(false);
    expect(isPasskeySessionRequired(undefined)).toBe(false);
  });
});

describe("inferred step-up refusals", () => {
  it("bounds a prompt built on a code the Hub never sent", () => {
    // `step_up_required` is synthesised from a bare `forbidden`. When the 403 was
    // really a role check, a lockout, or a gateway, no code can ever satisfy the
    // prompt — so it must stop asking rather than loop.
    const refusal = inferredStepUpRefusal();
    expect(refusal.inferredErrorCode).toBe(true);
    expect(shouldRetryStepUp(refusal, 1)).toBe(true);
    expect(shouldRetryStepUp(refusal, STEP_UP_INFERRED_ATTEMPT_LIMIT - 1)).toBe(true);
    expect(shouldRetryStepUp(refusal, STEP_UP_INFERRED_ATTEMPT_LIMIT)).toBe(false);
    expect(shouldRetryStepUp(refusal, STEP_UP_INFERRED_ATTEMPT_LIMIT + 1)).toBe(false);
  });

  it("still allows enough attempts for a mistyped or just-expired code", () => {
    // Codes rotate every 30 seconds. Giving up on the first refusal would fail
    // the users the prompt exists for.
    expect(STEP_UP_INFERRED_ATTEMPT_LIMIT).toBeGreaterThan(1);
  });

  it("does not bound a code the Hub actually sent", () => {
    // A wire code is authoritative: it means what it says, and only the user's
    // code is in question, so the prompt can keep asking.
    const authoritative = refused({
      errorCode: STEP_UP_REQUIRED_CODE,
      wireErrorCode: STEP_UP_REQUIRED_CODE,
      inferredErrorCode: false,
    });
    expect(shouldRetryStepUp(authoritative, STEP_UP_INFERRED_ATTEMPT_LIMIT * 10)).toBe(true);
  });
});

describe("inline error suppression", () => {
  const message = new HostedHubApiError(STEP_UP_REQUIRED_CODE, 403).message;

  it("withholds the step-up refusal while the prompt is carrying it", () => {
    expect(inlineErrorMessage(message, STEP_UP_REQUIRED_CODE, true)).toBeNull();
  });

  it("shows the step-up refusal once the prompt is gone, since nothing else would", () => {
    expect(inlineErrorMessage(message, STEP_UP_REQUIRED_CODE, false)).toBe(message);
  });

  it("never hides an unrelated failure, whatever its message says", () => {
    expect(inlineErrorMessage("Hub is temporarily unavailable.", "internal_error", true)).toBe(
      "Hub is temporarily unavailable.",
    );
    // A refusal that never reached the Hub carries no code at all.
    expect(inlineErrorMessage("Another account change is still in progress.", null, true)).toBe(
      "Another account change is still in progress.",
    );
    expect(inlineErrorMessage(message, "forbidden", true)).toBe(message);
    expect(inlineErrorMessage(null, STEP_UP_REQUIRED_CODE, true)).toBeNull();
  });
});

describe("passkey presentation", () => {
  it("reports revoked credentials rather than hiding them, and excludes them from the usable count", () => {
    const revoked = passkey({ id: "pkey_bbbbbbbbbbbbbbbbbbbbbb", revokedAt: 1 });
    expect(isPasskeyRevoked(revoked)).toBe(true);
    expect(activePasskeys([passkey(), revoked])).toHaveLength(1);
  });

  it("distinguishes unlabelled credentials by their public id", () => {
    const a = passkey({ id: "pkey_aaaaaaaaaaaaaaaaaaaaaa", label: null });
    const b = passkey({ id: "pkey_bbbbbbbbbbbbbbbbbbbbbb", label: "   " });
    expect(passkeyDisplayLabel(a)).not.toBe(passkeyDisplayLabel(b));
    expect(passkeyDisplayLabel(passkey({ label: " Work laptop " }))).toBe("Work laptop");
  });

  it("never renders an unreported backup state as 'not backed up'", () => {
    expect(passkeyBackupSummary(passkey())).toBeNull();
    expect(passkeyBackupSummary(passkey({ backupState: true }))).toMatch(/synced/i);
    expect(passkeyBackupSummary(passkey({ backupEligible: true }))).toMatch(/not yet backed up/i);
    expect(passkeyBackupSummary(passkey({ backupEligible: false }))).toMatch(/this device only/i);
  });

  it("omits a blank label rather than sending one the Hub rejects", () => {
    expect(normalizePasskeyLabel("   ")).toBeNull();
    expect(normalizePasskeyLabel("")).toBeNull();
    expect(normalizePasskeyLabel("  Phone  ")).toBe("Phone");
  });
});

describe("TOTP code input", () => {
  it("strips the separators authenticator apps and pastes carry", () => {
    expect(normalizeTotpCode("123 456")).toBe("123456");
    expect(normalizeTotpCode("123-456")).toBe("123456");
    expect(normalizeTotpCode(" 123456\n")).toBe("123456");
  });

  it("stays inside the Hub's bound", () => {
    expect(normalizeTotpCode("1".repeat(64))).toHaveLength(TOTP_CODE_MAX_LENGTH);
  });

  it("refuses to submit a code that cannot be one", () => {
    expect(isSubmittableTotpCode("")).toBe(false);
    expect(isSubmittableTotpCode("12345")).toBe(false);
    expect(isSubmittableTotpCode("abcdef")).toBe(false);
    expect(isSubmittableTotpCode("123456")).toBe(true);
    expect(isSubmittableTotpCode("123 456")).toBe(true);
  });
});

describe("credential input validation", () => {
  it("owns the confirmation match and leaves strength to the Hub", () => {
    expect(passwordIssue("", "")).toMatch(/enter a password/i);
    expect(passwordIssue("correct horse", "")).toMatch(/re-enter/i);
    expect(passwordIssue("correct horse", "correct horsf")).toMatch(/do not match/i);
    expect(passwordIssue("a", "a")).toBeNull();
    expect(passwordIssue("x".repeat(257), "x".repeat(257))).toMatch(/256/);
  });

  it("checks email structurally without second-guessing deliverability", () => {
    expect(emailIssue("")).toMatch(/enter an email/i);
    expect(emailIssue("not-an-email")).toMatch(/valid email/i);
    expect(emailIssue("ada@example.com")).toBeNull();
    expect(emailIssue("  ada@example.com  ")).toBeNull();
    expect(emailIssue("ada+tag@sub.example.co.uk")).toBeNull();
    expect(emailIssue(`${"a".repeat(250)}@example.com`)).toMatch(/254/);
  });
});

describe("recovery-code clipboard form", () => {
  it("is one code per line", () => {
    expect(formatRecoveryCodesForClipboard(["aaa", "bbb"])).toBe("aaa\nbbb");
    expect(formatRecoveryCodesForClipboard([])).toBe("");
  });
});

describe("step-up prompt copy", () => {
  it("names the action being confirmed", () => {
    expect(stepUpTitle("regenerate-recovery-codes")).toMatch(/recovery codes/i);
    expect(stepUpTitle("set-password")).toMatch(/password/i);
  });

  it("does not claim to know whether the first code was wrong or missing", () => {
    const first = stepUpDescription(0);
    const retry = stepUpDescription(1);
    expect(first).not.toBe(retry);
    expect(first).toMatch(/not started with a passkey/i);
    expect(retry).toMatch(/not accepted/i);
  });
});

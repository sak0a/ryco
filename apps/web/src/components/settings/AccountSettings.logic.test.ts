import { describe, expect, it } from "vite-plus/test";
import {
  HostedHubApiError,
  HOSTED_PASSKEY_UNCONFIRMED_MESSAGE,
  PASSKEY_SESSION_REQUIRED_CODE,
  STEP_UP_REQUIRED_CODE,
  type HostedHubPasskey,
} from "@ryco/client-runtime/authorization";

import {
  accountActionOutcome,
  activePasskeys,
  emailIssue,
  formatRecoveryCodesForClipboard,
  inlineErrorMessage,
  isPasskeyRevoked,
  isPasskeySessionRequired,
  isSettledAccountAction,
  isStepUpRequired,
  isSubmittableTotpCode,
  mayHaveEnrolledPasskey,
  normalizePasskeyLabel,
  normalizeTotpCode,
  PASSKEY_SESSION_REQUIRED_MESSAGE,
  passkeyBackupSummary,
  passkeyDisplayLabel,
  passwordIssue,
  stepUpDescription,
  stepUpTitle,
  STEP_UP_REQUIRED_MESSAGE,
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

describe("step-up classification", () => {
  it("recognises the runtime's own step-up refusal, whatever the intent", () => {
    // Every step-up intent narrows a 403 to the same code, and the code carries
    // one message; the surface must recognise all of them.
    for (const intent of [
      "set-password",
      "remove-password",
      "revoke-totp",
      "request-email-verification",
      "add-passkey",
      "regenerate-recovery-codes",
    ] as const) {
      const error = new HostedHubApiError(STEP_UP_REQUIRED_CODE, 403, undefined, intent);
      expect(isStepUpRequired(error.message)).toBe(true);
      expect(isPasskeySessionRequired(error.message)).toBe(false);
    }
  });

  it("recognises the passkey-session gate, which has no step-up out of it", () => {
    for (const intent of ["begin-totp-enrollment", "confirm-totp-enrollment"] as const) {
      const error = new HostedHubApiError(PASSKEY_SESSION_REQUIRED_CODE, 403, undefined, intent);
      expect(isPasskeySessionRequired(error.message)).toBe(true);
      expect(isStepUpRequired(error.message)).toBe(false);
    }
  });

  it("never mistakes another failure for a step-up", () => {
    for (const code of [
      "conflict",
      "forbidden",
      "unauthorized",
      "rate_limited",
      "authentication_failed",
      "invalid_response",
    ]) {
      const message = new HostedHubApiError(code, 400).message;
      expect(isStepUpRequired(message)).toBe(false);
      expect(isPasskeySessionRequired(message)).toBe(false);
    }
    expect(isStepUpRequired(null)).toBe(false);
    expect(isStepUpRequired("")).toBe(false);
    expect(isPasskeySessionRequired(null)).toBe(false);
  });

  it("keeps the two sentinels distinct", () => {
    expect(STEP_UP_REQUIRED_MESSAGE).not.toBe(PASSKEY_SESSION_REQUIRED_MESSAGE);
    expect(STEP_UP_REQUIRED_MESSAGE.length).toBeGreaterThan(0);
    expect(PASSKEY_SESSION_REQUIRED_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe("account action outcome", () => {
  const outcome = (
    action: Parameters<typeof accountActionOutcome>[0]["action"],
    errorMessage: string | null,
    passkeysStatus: Parameters<typeof accountActionOutcome>[0]["passkeysStatus"] = "ready",
  ) => accountActionOutcome({ action, errorMessage, passkeysStatus });

  it("reads a clean store as a commit, and the step-up sentinel as a prompt", () => {
    expect(outcome("set-password", null)).toBe("committed");
    expect(outcome("set-password", STEP_UP_REQUIRED_MESSAGE)).toBe("step-up-required");
    expect(isSettledAccountAction("committed")).toBe(true);
    expect(isSettledAccountAction("step-up-required")).toBe(false);
    expect(isSettledAccountAction("failed")).toBe(false);
  });

  it("treats a passkey add whose confirming re-read failed as settled, not failed", () => {
    // The credential is already on the account; reporting a failure here is
    // what invites a second ceremony and a duplicate credential.
    expect(outcome("add-passkey", "The Hub could not be reached.", "stale")).toBe("unverified");
    expect(outcome("add-passkey", HOSTED_PASSKEY_UNCONFIRMED_MESSAGE, "ready")).toBe("unverified");
    expect(isSettledAccountAction("unverified")).toBe(true);
  });

  it("still reports a passkey add that never committed as a failure", () => {
    expect(outcome("add-passkey", "That credential is already registered.", "ready")).toBe(
      "failed",
    );
  });

  it("never extends the post-commit reading to an action that does not do it", () => {
    // Only `addPasskey` writes an error after committing. A stale passkey list
    // left over from an unrelated read must not turn a failed password change
    // into a silent success.
    expect(outcome("set-password", "That password has appeared in a breach.", "stale")).toBe(
      "failed",
    );
    expect(outcome("regenerate-recovery-codes", "Hub unavailable.", "stale")).toBe("failed");
  });

  it("never reads a step-up refusal as a commit, whatever the passkey list says", () => {
    expect(outcome("add-passkey", STEP_UP_REQUIRED_MESSAGE, "stale")).toBe("step-up-required");
  });

  it("is one-sided about an unconfirmed enrolment", () => {
    expect(
      mayHaveEnrolledPasskey({
        errorMessage: HOSTED_PASSKEY_UNCONFIRMED_MESSAGE,
        passkeysStatus: "ready",
      }),
    ).toBe(true);
    expect(mayHaveEnrolledPasskey({ errorMessage: "Anything.", passkeysStatus: "stale" })).toBe(
      true,
    );
    expect(mayHaveEnrolledPasskey({ errorMessage: "Anything.", passkeysStatus: "ready" })).toBe(
      false,
    );
  });
});

describe("inline error suppression", () => {
  it("withholds the step-up refusal while the prompt is carrying it", () => {
    expect(inlineErrorMessage(STEP_UP_REQUIRED_MESSAGE, true)).toBeNull();
  });

  it("shows the step-up refusal once the prompt is gone, since nothing else would", () => {
    expect(inlineErrorMessage(STEP_UP_REQUIRED_MESSAGE, false)).toBe(STEP_UP_REQUIRED_MESSAGE);
  });

  it("never hides an unrelated failure", () => {
    expect(inlineErrorMessage("Hub is temporarily unavailable.", true)).toBe(
      "Hub is temporarily unavailable.",
    );
    expect(inlineErrorMessage(null, true)).toBeNull();
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

import { describe, expect, it } from "vitest";

import {
  mailboxCodePrompt,
  PRIVATE_MAILBOX_PRESENTATION,
  PRIVATE_RESET_MAILBOX_PRESENTATION,
  passwordResetMailboxPresentation,
} from "./nativeIdentityPresentation";

describe("native identity mailbox presentation", () => {
  it("shows the selected in-memory address", () => {
    expect(mailboxCodePrompt("person@example.com")).toBe(
      "Enter the six-digit code sent to person@example.com.",
    );
  });

  it("has a non-PII restart fallback", () => {
    expect(mailboxCodePrompt(PRIVATE_MAILBOX_PRESENTATION)).toBe(
      "Enter the six-digit code sent to your email.",
    );
  });

  it("keeps email password reset enumeration-safe while showing the selected address", () => {
    expect(mailboxCodePrompt(passwordResetMailboxPresentation("person@example.com", true))).toBe(
      "Enter the six-digit code sent to person@example.com if an account exists for that email.",
    );
  });

  it("describes the linked mailbox when password reset starts from a username", () => {
    expect(mailboxCodePrompt(passwordResetMailboxPresentation("person_name", false))).toBe(
      "Enter the six-digit code sent to the email linked to person_name if that account exists.",
    );
  });

  it("has an enumeration-safe non-PII reset fallback", () => {
    expect(mailboxCodePrompt(PRIVATE_RESET_MAILBOX_PRESENTATION)).toBe(
      "Enter the six-digit code sent to your email if the account exists.",
    );
  });
});

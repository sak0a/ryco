import { describe, expect, it } from "vitest";

import {
  mailboxCodePrompt,
  PRIVATE_MAILBOX_PRESENTATION,
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
});

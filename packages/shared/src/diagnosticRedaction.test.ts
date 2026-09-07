import { describe, expect, it } from "vite-plus/test";
import { redactDiagnosticText } from "./diagnosticRedaction.ts";

describe("diagnostic text redaction", () => {
  it("removes embedded credentials while retaining useful error context", () => {
    const value =
      'Request failed: Bearer very-private-token, password="secret with spaces" url=https://alice:password@example.com/api?ticket=private-ticket#private-fragment';
    const redacted = redactDiagnosticText(value);
    for (const secret of [
      "very-private-token",
      "secret with spaces",
      "alice",
      "private-ticket",
      "private-fragment",
    ]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain("Request failed:");
    expect(redacted).toContain("example.com/api");
  });
  it("removes provider keys, JWTs and multiline private keys", () => {
    expect(redactDiagnosticText("sk-abcdefghijk ghp_abcdefghijkl eyJhbGc.eyJzdWI.signature")).toBe(
      "[redacted] [redacted] [redacted]",
    );
    expect(
      redactDiagnosticText("-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----"),
    ).toBe("[redacted]");
    expect(redactDiagnosticText("Checkpoint took 240 ms")).toBe("Checkpoint took 240 ms");
  });
});

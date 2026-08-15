import { assert, describe, it } from "@effect/vitest";

import { sanitizeDiagnostic } from "./browserProbe.ts";

describe("external browser diagnostics", () => {
  it("removes query, hash, and credential values from errors", () => {
    const sanitized = sanitizeDiagnostic(
      "WebSocket wss://example.test/ws?wsToken=secret failed; Token: another-secret; https://example.test/pair#token=third",
    );
    assert.equal(
      sanitized,
      "WebSocket wss://example.test/ws?[redacted] failed; Token=[redacted] https://example.test/pair?[redacted]",
    );
    assert.notInclude(sanitized, "secret");
  });
});

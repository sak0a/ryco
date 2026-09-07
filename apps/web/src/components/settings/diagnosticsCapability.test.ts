import { describe, expect, it } from "vite-plus/test";
import { canRequestDirectDiagnostics } from "./diagnosticsCapability";

describe("direct diagnostics capability", () => {
  it("allows the authenticated primary connection without a saved-environment role", () => {
    expect(canRequestDirectDiagnostics({ primary: true, connected: true, role: undefined })).toBe(
      true,
    );
    expect(canRequestDirectDiagnostics({ primary: true, connected: true, role: null })).toBe(true);
  });
  it("requires an owner role for saved nodes and denies disconnected or known client sessions", () => {
    expect(canRequestDirectDiagnostics({ primary: false, connected: true, role: "owner" })).toBe(
      true,
    );
    expect(canRequestDirectDiagnostics({ primary: false, connected: true, role: null })).toBe(
      false,
    );
    for (const primary of [true, false]) {
      expect(canRequestDirectDiagnostics({ primary, connected: false, role: "owner" })).toBe(false);
      expect(canRequestDirectDiagnostics({ primary, connected: true, role: "client" })).toBe(false);
    }
  });
});

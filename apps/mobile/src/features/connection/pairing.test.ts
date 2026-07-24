import { describe, expect, it } from "vite-plus/test";

import {
  buildPairingUrl,
  extractPairingUrlFromQrPayload,
  PairingQrPayloadEmptyError,
  parsePairingUrl,
} from "./pairing";

describe("pairing", () => {
  it("round-trips host + code into a pairing URL and back", () => {
    const url = buildPairingUrl("node.local:44342", "tok-123");
    expect(parsePairingUrl(url)).toEqual({ host: "https://node.local:44342", code: "tok-123" });
  });

  it("extracts the pairing token from hash or query", () => {
    expect(parsePairingUrl("https://node.local/#token=abc").code).toBe("abc");
    expect(parsePairingUrl("https://node.local/?token=xyz").code).toBe("xyz");
  });

  it("unwraps a ryco* QR scheme into the embedded pairing URL", () => {
    for (const scheme of ["ryco", "ryco-dev", "ryco-preview"]) {
      const inner = "https://node.local/#token=zzz";
      const payload = `${scheme}://pair?pairingUrl=${encodeURIComponent(inner)}`;
      expect(extractPairingUrlFromQrPayload(payload)).toBe(inner);
    }
  });

  it("passes a raw pairing URL through unchanged", () => {
    const raw = "ryco://pair?host=node.local#token=tok";
    // A ryco URL with no pairingUrl param is returned as-is for normal validation.
    expect(extractPairingUrlFromQrPayload(raw)).toBe(raw);
    expect(extractPairingUrlFromQrPayload("https://node.local/#token=tok")).toBe(
      "https://node.local/#token=tok",
    );
  });

  it("rejects an empty QR payload", () => {
    expect(() => extractPairingUrlFromQrPayload("   ")).toThrow(PairingQrPayloadEmptyError);
  });
});

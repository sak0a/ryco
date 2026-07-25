import { describe, expect, it } from "vite-plus/test";

import { QrCode } from "@ryco/shared/qrCode";

import {
  HOSTED_QR_QUIET_ZONE,
  deriveHostedQrMatrix,
  hostedQrPath,
  hostedQrViewBoxSize,
} from "./hostedTotpQr";

const PROVISIONING_URI =
  "otpauth://totp/Ryco:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Ryco&algorithm=SHA1&digits=6&period=30";

describe("hosted TOTP QR geometry", () => {
  it("encodes a provisioning URI as a square matrix with a quiet zone", () => {
    const matrix = deriveHostedQrMatrix(PROVISIONING_URI);
    expect(matrix).not.toBeNull();
    if (!matrix) return;
    expect(matrix.size).toBeGreaterThan(20);
    expect(matrix.modules).toHaveLength(matrix.size * matrix.size);
    expect(matrix.quietZone).toBe(HOSTED_QR_QUIET_ZONE);
    expect(hostedQrViewBoxSize(matrix)).toBe(matrix.size + HOSTED_QR_QUIET_ZONE * 2);
  });

  it("reproduces the encoder's own modules, so the symbol actually scans", () => {
    const matrix = deriveHostedQrMatrix(PROVISIONING_URI);
    const encoded = QrCode.encodeText(PROVISIONING_URI, QrCode.Ecc.MEDIUM);
    expect(matrix?.size).toBe(encoded.size);
    if (!matrix) return;
    for (let y = 0; y < encoded.size; y += 1) {
      for (let x = 0; x < encoded.size; x += 1) {
        expect(matrix.modules[y * matrix.size + x], `module ${x},${y}`).toBe(
          encoded.getModule(x, y),
        );
      }
    }
  });

  it("carries the finder pattern the standard requires at the top-left", () => {
    const matrix = deriveHostedQrMatrix(PROVISIONING_URI);
    if (!matrix) throw new Error("expected a matrix");
    const at = (x: number, y: number) => matrix.modules[y * matrix.size + x];
    // 7x7 finder: dark ring, light ring, 3x3 dark core.
    for (let i = 0; i < 7; i += 1) {
      expect(at(i, 0), `top edge ${i}`).toBe(true);
      expect(at(0, i), `left edge ${i}`).toBe(true);
    }
    expect(at(1, 1)).toBe(false);
    expect(at(3, 3)).toBe(true);
    // The separator column immediately right of the finder is light.
    expect(at(7, 0)).toBe(false);
  });

  it("fails closed instead of throwing, and never echoes the input", () => {
    expect(deriveHostedQrMatrix("")).toBeNull();
    expect(deriveHostedQrMatrix("x".repeat(4000))).toBeNull();
    expect(deriveHostedQrMatrix(undefined as unknown as string)).toBeNull();
  });

  it("merges horizontal runs into one subpath per run, offset by the quiet zone", () => {
    const path = hostedQrPath({
      size: 4,
      quietZone: 2,
      // Row 0: two adjacent dark modules then a gap then one.
      // Row 1: empty. Row 2: one. Row 3: empty.
      modules: [
        true,
        true,
        false,
        true, //
        false,
        false,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
        false,
        false,
        false,
      ],
    });
    expect(path).toBe("M2 2h2v1h-2zM5 2h1v1h-1zM3 4h1v1h-1z");
  });

  it("emits an empty path for an all-light matrix rather than a stray subpath", () => {
    expect(hostedQrPath({ size: 2, quietZone: 4, modules: [false, false, false, false] })).toBe("");
  });

  /**
   * The URI embeds the account's shared TOTP secret. The geometry is booleans
   * and integers, so nothing downstream — a log line, a serialized view model,
   * a crash report — can recover the secret from a matrix or a path.
   */
  it("returns no string derived from the secret", () => {
    const matrix = deriveHostedQrMatrix(PROVISIONING_URI);
    if (!matrix) throw new Error("expected a matrix");
    expect(matrix.modules.every((module) => typeof module === "boolean")).toBe(true);
    const serialized = `${JSON.stringify(matrix)} ${hostedQrPath(matrix)}`;
    // No fragment of the shared key, and nothing of the URI that wraps it,
    // survives into the geometry — down to four-character windows.
    const secret = "JBSWY3DPEHPK3PXP";
    for (let index = 0; index + 4 <= secret.length; index += 1) {
      expect(serialized).not.toContain(secret.slice(index, index + 4));
    }
    expect(serialized).not.toContain("otpauth");
    expect(serialized).not.toContain("ada%40example.com");
  });
});

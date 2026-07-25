import { QrCode } from "@ryco/shared/qrCode";

/**
 * The TOTP enrolment QR code, as pure geometry.
 *
 * Kept apart from any `.tsx` for the reason every other model in this feature
 * is: `react-native` ships untranspiled Flow and cannot load under the vp/node
 * runner, so a matrix built inside a component would be untestable. Here it is
 * a plain function over a string and is asserted directly.
 *
 * ## The input is secret key material
 *
 * `provisioningUri` is an `otpauth://` URI that **embeds the account's shared
 * TOTP secret**. It is passed in, turned into geometry, and dropped. This module
 * therefore:
 *
 * - never stores it in module scope, a cache, or a closure that outlives the
 *   call,
 * - never logs it, and never places it (or any fragment of it) in a thrown
 *   error or a returned value — a failure is a bare `null`,
 * - returns only booleans, so nothing downstream can recover the URI from the
 *   result without already having it.
 *
 * The encoder is the repo's existing `@ryco/shared/qrCode` (Nayuki, MIT), the
 * same one the CLI renders pairing codes with. Nothing new is vendored and no
 * network font, image, or service is involved: the QR is drawn from these
 * booleans.
 */

/**
 * The quiet zone required around a QR symbol. Four modules is the ISO/IEC 18004
 * minimum; scanners fail on symbols rendered flush to their container, so it is
 * part of the geometry rather than a styling choice a surface may drop.
 */
export const HOSTED_QR_QUIET_ZONE = 4;

/**
 * An `otpauth://` URI is short (well under 200 bytes in practice), so anything
 * beyond this is not a provisioning URI this surface should be rendering. The
 * runtime already bounds it at 2048; this is the second, narrower gate on the
 * value actually reaching an encoder.
 */
const MAX_ENCODED_LENGTH = 1024;

export interface HostedQrMatrix {
  /** Module count per side, excluding the quiet zone. */
  readonly size: number;
  readonly quietZone: number;
  /** Row-major dark-module flags, exactly `size * size` long. */
  readonly modules: ReadonlyArray<boolean>;
}

/**
 * Encode a value as a QR matrix, or `null` when it cannot be encoded.
 *
 * Fails closed rather than throwing: the caller is a render path, and an
 * exception carrying the encoder's own diagnostics would put the provisioning
 * URI — and therefore the secret — into an error string. A `null` matrix simply
 * means the surface falls back to the manual-entry secret, which is the
 * authenticator apps' documented alternative anyway.
 */
export function deriveHostedQrMatrix(value: string): HostedQrMatrix | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENCODED_LENGTH) {
    return null;
  }
  let encoded: QrCode;
  try {
    // MEDIUM: the ~15% recovery level authenticator apps are documented against,
    // and the level the encoder itself will upgrade from when it is free to.
    encoded = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
  } catch {
    return null;
  }
  const size = encoded.size;
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const modules: boolean[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) modules.push(encoded.getModule(x, y));
  }
  return { size, quietZone: HOSTED_QR_QUIET_ZONE, modules };
}

/**
 * An SVG path covering every dark module, in the matrix's own coordinate space
 * offset by the quiet zone.
 *
 * One path rather than one rect per module: a version-3 symbol is 29×29, so the
 * naive form is ~400 native views on a screen that also hosts a text input.
 * Horizontally adjacent modules are merged into a single run, which typically
 * cuts the subpath count by more than half again.
 */
export function hostedQrPath(matrix: HostedQrMatrix): string {
  const { size, quietZone, modules } = matrix;
  const parts: string[] = [];
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (!modules[y * size + x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < size && modules[y * size + x + run]) run += 1;
      parts.push(`M${x + quietZone} ${y + quietZone}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return parts.join("");
}

/** The rendered side length, in module units, including both quiet zones. */
export function hostedQrViewBoxSize(matrix: HostedQrMatrix): number {
  return matrix.size + matrix.quietZone * 2;
}

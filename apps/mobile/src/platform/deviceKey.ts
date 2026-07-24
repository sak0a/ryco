import type { DpopSigningKey } from "@ryco/client-runtime/relay";

import { derSignatureToRaw, uncompressedPointToJwk } from "./ecdsa";

/**
 * Builds a {@link DpopSigningKey} over the hardware device-key module.
 *
 * The native module is loaded lazily so importing the platform barrel never
 * touches the keystore, and the resulting key is memoized: the signer is built
 * once per key, never per request.
 *
 * Fails closed throughout. There is no software fallback — if the enclave or
 * StrongBox is unavailable the hosted plane must present an unavailable state
 * rather than sign with a weaker key.
 */

export type DeviceKeyBacking = "secure-enclave" | "strongbox" | "unavailable";

type DeviceKeyModule = (typeof import("@ryco/mobile-device-key"))["default"];

const HARDWARE_BACKINGS: ReadonlySet<string> = new Set<DeviceKeyBacking>([
  "secure-enclave",
  "strongbox",
]);

const UNAVAILABLE = "A hardware-backed device key is unavailable on this device.";

let modulePromise: Promise<DeviceKeyModule> | undefined;
let signingKeyPromise: Promise<DpopSigningKey> | undefined;

async function loadDeviceKeyModule(): Promise<DeviceKeyModule> {
  modulePromise ??= import("@ryco/mobile-device-key").then((module) => module.default);
  return await modulePromise;
}

/** Base64 (not base64url) is the native module's wire format for raw bytes. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

/**
 * Resolve the hardware signing key, creating it on first use.
 *
 * Rejects with a stable, bounded message when hardware backing is missing. The
 * rejection is not memoized, so a later attempt (for example after the user
 * sets a device passcode) can still succeed.
 */
export async function getMobileDeviceSigningKey(): Promise<DpopSigningKey> {
  signingKeyPromise ??= (async () => {
    const module = await loadDeviceKeyModule();
    const { publicKey, backing } = await module.ensureKey();
    if (!HARDWARE_BACKINGS.has(backing)) throw new Error(UNAVAILABLE);
    const publicJwk = uncompressedPointToJwk(fromBase64(publicKey));
    return {
      algorithm: "ES256",
      publicJwk,
      sign: async (signingInput: Uint8Array): Promise<Uint8Array> => {
        const signature = await module.sign(toBase64(signingInput));
        // Both platforms return DER; JWS ES256 requires raw `r ‖ s`.
        return derSignatureToRaw(fromBase64(signature));
      },
    } satisfies DpopSigningKey;
  })().catch((cause: unknown) => {
    signingKeyPromise = undefined;
    throw cause instanceof Error && cause.message === UNAVAILABLE ? cause : new Error(UNAVAILABLE);
  });
  return await signingKeyPromise;
}

/** Whether a hardware key can be used, without surfacing why it cannot. */
export async function isMobileDeviceKeyAvailable(): Promise<boolean> {
  try {
    await getMobileDeviceSigningKey();
    return true;
  } catch {
    return false;
  }
}

/** Test seam: drop the memoized native module and signing key between cases. */
export function resetMobileDeviceKeyForTests(): void {
  modulePromise = undefined;
  signingKeyPromise = undefined;
}

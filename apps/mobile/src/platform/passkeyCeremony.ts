import type { PasskeyCeremonyService } from "@ryco/client-runtime/platform";

import {
  encodeAuthenticationRequest,
  encodeRegistrationRequest,
  mapNativePasskeyError,
  normalizeAuthenticationResponse,
  normalizeRegistrationResponse,
  withPasskeyAbort,
  type DecodedAuthenticationOptions,
  type DecodedRegistrationOptions,
} from "./passkeyTranscript";

/**
 * Native passkey ceremonies (iOS AuthenticationServices / Android Credential
 * Manager) behind the runtime's `PasskeyCeremony` seam.
 *
 * The runtime validates and decodes the server's options before calling this
 * adapter, so binary members arrive as `Uint8Array`; all encoding, normalizing,
 * and error bounding lives in the pure `passkeyTranscript` module so it is
 * testable without a native binary. This file owns only the native call.
 *
 * The native module is loaded lazily rather than at import time. It reaches
 * into `NativeModules` as a side effect of being required, which would pull the
 * native bridge into every consumer of the platform barrel — including the
 * direct plane, which never runs a passkey ceremony.
 */

type PasskeyModule = typeof import("react-native-passkey");

let modulePromise: Promise<PasskeyModule> | undefined;

function loadPasskeyModule(): Promise<PasskeyModule> {
  modulePromise ??= import("react-native-passkey");
  return modulePromise;
}

/** Test seam: drop the memoized native module between cases. */
export function resetPasskeyModuleForTests(): void {
  modulePromise = undefined;
}

/** Whether the platform can run a passkey ceremony at all (iOS 15+ / Android 28+). */
export async function isMobilePasskeySupported(): Promise<boolean> {
  try {
    const { Passkey } = await loadPasskeyModule();
    return Passkey.isSupported();
  } catch {
    return false;
  }
}

/**
 * The casts at the native call are the single boundary where the library's
 * narrower extension typings are widened to what WebAuthn allows: server
 * -supplied extensions are passed through verbatim rather than filtered to the
 * subset the library happens to declare.
 */
export const mobilePasskeyCeremony: PasskeyCeremonyService = {
  authenticate: async (options, signal) => {
    const request = encodeAuthenticationRequest(options as DecodedAuthenticationOptions);
    const result = await withPasskeyAbort(signal, async () => {
      try {
        const { Passkey } = await loadPasskeyModule();
        return await Passkey.get(request as Parameters<typeof Passkey.get>[0]);
      } catch (cause) {
        throw mapNativePasskeyError(cause);
      }
    });
    return normalizeAuthenticationResponse(result);
  },
  register: async (options, signal) => {
    const request = encodeRegistrationRequest(options as DecodedRegistrationOptions);
    const result = await withPasskeyAbort(signal, async () => {
      try {
        const { Passkey } = await loadPasskeyModule();
        return await Passkey.create(request as Parameters<typeof Passkey.create>[0]);
      } catch (cause) {
        throw mapNativePasskeyError(cause);
      }
    });
    return normalizeRegistrationResponse(result);
  },
};

import type { PasskeyCeremonyService } from "@ryco/client-runtime/platform";

import { createPasskeyRegistration, getPasskeyAuthentication } from "../hostedHub/webauthn";

export const webPasskeyCeremony: PasskeyCeremonyService = {
  authenticate: (options, signal) =>
    getPasskeyAuthentication(options, signal as AbortSignal | undefined),
  register: (options, signal) =>
    createPasskeyRegistration(options, signal as AbortSignal | undefined),
};

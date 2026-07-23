import type { PairingCredentialSourceService } from "@ryco/client-runtime/platform";

import { takePairingTokenFromUrl } from "../environments/primary/pairingCredential";

export const webPairingCredentialSource: PairingCredentialSourceService = {
  take: async () => takePairingTokenFromUrl(),
};

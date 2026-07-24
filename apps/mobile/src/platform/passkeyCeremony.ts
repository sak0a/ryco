import type { PasskeyCeremonyService } from "@ryco/client-runtime/platform";

// B1 stub. Native passkeys (and the Hub-side bearer session + associated-domains
// prerequisite) land with workstream C. The direct-node bearer plane is the B1
// auth path and does not use this adapter. Throwing keeps the hosted plane inert
// rather than silently returning an invalid ceremony.
const HOSTED_UNAVAILABLE = "hosted mode not available";

export const mobilePasskeyCeremony: PasskeyCeremonyService = {
  authenticate: () => Promise.reject(new Error(HOSTED_UNAVAILABLE)),
  register: () => Promise.reject(new Error(HOSTED_UNAVAILABLE)),
};

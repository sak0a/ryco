import type { SessionCredentialsService } from "@ryco/client-runtime/platform";

// A native client cannot use the browser cookie session, so the hosted plane's
// session mode is "bearer" (workstream C completes the Hub-side bearer session +
// ticket issuance). For B1 the hosted plane is inert and the direct-node bearer
// flow lives in the remote-environment API, not here; this adapter only holds
// the in-memory CSRF token the contract requires.
export function createMobileSessionCredentials(): SessionCredentialsService {
  let csrfToken: string | null = null;
  return {
    mode: "bearer",
    readCsrfToken: () => csrfToken,
    writeCsrfToken: (token) => {
      csrfToken = token;
    },
  };
}

export const mobileSessionCredentials = createMobileSessionCredentials();

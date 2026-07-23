import type { SessionCredentialsService } from "@ryco/client-runtime/platform";

export function createWebSessionCredentials(): SessionCredentialsService {
  let csrfToken: string | null = null;
  return {
    mode: "cookie",
    readCsrfToken: () => csrfToken,
    writeCsrfToken: (token) => {
      csrfToken = token;
    },
  };
}

export const webSessionCredentials = createWebSessionCredentials();

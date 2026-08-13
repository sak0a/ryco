export type AppAccess =
  | { readonly status: "hydrating" }
  | { readonly status: "locked" }
  | {
      readonly status: "unlocked";
      readonly via: "hosted-session" | "direct-node" | "both";
    };

export interface AppAccessFacts {
  readonly hostedHydrated: boolean;
  readonly hostedSessionRevalidated: boolean;
  readonly directHydrated: boolean;
  readonly directCredentialReadable: boolean;
}

/**
 * The one startup authority projection. Profiles, stored-token presence,
 * onboarding preferences, and partially completed ceremonies are deliberately
 * not inputs: none of them proves that this device can enter the workspace.
 */
export function deriveAppAccess(facts: AppAccessFacts): AppAccess {
  if (!facts.hostedHydrated || !facts.directHydrated) return { status: "hydrating" };
  if (facts.hostedSessionRevalidated && facts.directCredentialReadable) {
    return { status: "unlocked", via: "both" };
  }
  if (facts.hostedSessionRevalidated) {
    return { status: "unlocked", via: "hosted-session" };
  }
  if (facts.directCredentialReadable) {
    return { status: "unlocked", via: "direct-node" };
  }
  return { status: "locked" };
}

/** Only workspace destinations are deferred; auth/reset/direct links stay in the blocker. */
export function isWorkspaceDeepLink(value: string): boolean {
  try {
    const url = new URL(value);
    const path =
      `${url.protocol === "http:" || url.protocol === "https:" ? "" : url.hostname}${url.pathname}`
        .replace(/^\/+/, "")
        .toLocaleLowerCase();
    return (
      path.startsWith("threads/") ||
      path.startsWith("projects/") ||
      path === "tasks/new" ||
      path === "settings" ||
      path.startsWith("settings/")
    );
  } catch {
    return false;
  }
}

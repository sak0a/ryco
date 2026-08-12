import { deriveOnboardingMigration } from "./onboardingModel";
import type { OnboardingProgress, OnboardingProgressStatus } from "./onboardingProgress";

export function resolveFirstRunStartup(input: {
  readonly progress: OnboardingProgress | null;
  readonly hasStoredHub: boolean;
  readonly directEnvironmentCount: number;
  readonly hostedAuthenticated: boolean;
}): { readonly status: OnboardingProgressStatus; readonly persist: boolean } {
  return {
    status: deriveOnboardingMigration(input),
    persist: input.progress === null,
  };
}

export type FirstRunLaunchDisposition = "present" | "defer" | "none";

export function deriveFirstRunLaunchDisposition(input: {
  readonly status: OnboardingProgressStatus;
  readonly routeNames: ReadonlyArray<string>;
  readonly presentationRequested: boolean;
  readonly hasInitialDeepLink?: boolean;
}): FirstRunLaunchDisposition {
  if (input.status === "completed" || input.presentationRequested) return "none";
  if (input.hasInitialDeepLink) return "defer";
  return input.routeNames.length === 1 && input.routeNames[0] === "Home" ? "present" : "defer";
}

/** Expo's development-client launcher is filtered from navigation and is a neutral app launch. */
export function hasActionableInitialDeepLink(initialUrl: string | null): boolean {
  return initialUrl !== null && !initialUrl.includes("expo-development-client");
}

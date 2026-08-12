import { mobileE2eeTrustStore } from "../platform/e2eeTrustStore";
import { mobileKV } from "../platform/kv";
import { clearMobileHostedSessionToken } from "../platform/sessionCredentials";
import { clearMobileHubProfile, saveMobileHubProfile } from "./hubProfile";
import { createHubProfileReplacementService } from "./hubProfileReplacement";
import { invalidateMobileHostedRuntime } from "./runtime";
import {
  ensureMobileHostedSession,
  hostedHubController,
  hostedHubStore,
  isMobileHostedModeAvailable,
} from "./state";

/** Bind the pure replacement engine to the single-homed mobile Hub services. */
export function createMobileHubProfileReplacementService() {
  return createHubProfileReplacementService({
    saveProfile: (profile) => saveMobileHubProfile(mobileKV, profile),
    clearProfile: () => clearMobileHubProfile(mobileKV),
    hostedAvailable: isMobileHostedModeAvailable,
    accountStatus: () => hostedHubStore.getState().accountStatus,
    signOut: () => hostedHubController.signOut(),
    expireSession: () => hostedHubController.expireSession(),
    clearSessionToken: clearMobileHostedSessionToken,
    forgetHubOrigin: (origin) => mobileE2eeTrustStore.forgetHubOrigin(origin),
    invalidateRuntime: invalidateMobileHostedRuntime,
    bootstrapSession: () => void ensureMobileHostedSession(),
  });
}

import {
  buildHubDomainResetPlan,
  executeHubDomainResetPlan,
  type HubDomainResetPlan,
  type HubProfile,
} from "./hubProfile";

export interface HubProfileReplacementDependencies {
  readonly saveProfile: (profile: HubProfile) => Promise<unknown>;
  readonly clearProfile: () => Promise<unknown>;
  readonly hostedAvailable: () => boolean;
  readonly accountStatus: () => string;
  readonly signOut: () => Promise<unknown>;
  readonly expireSession: () => Promise<unknown>;
  readonly clearSessionToken: () => Promise<unknown>;
  readonly forgetHubOrigin: (origin: string) => Promise<unknown>;
  readonly invalidateRuntime: () => void;
  readonly bootstrapSession: () => void;
}

export interface HubProfileReplacementService {
  readonly plan: (
    currentProfile: HubProfile | null,
    nextProfile: HubProfile | null,
  ) => HubDomainResetPlan | null;
  readonly replace: (
    currentProfile: HubProfile | null,
    nextProfile: HubProfile | null,
  ) => Promise<{
    readonly profile: HubProfile | null;
    readonly remoteSignOut: "completed" | "unavailable" | "not-required";
  }>;
}

export function createHubProfileReplacementService(
  dependencies: HubProfileReplacementDependencies,
): HubProfileReplacementService {
  const plan = (currentProfile: HubProfile | null, nextProfile: HubProfile | null) =>
    buildHubDomainResetPlan(currentProfile?.origin ?? null, nextProfile?.origin ?? null);

  const persist = async (nextProfile: HubProfile | null) => {
    if (nextProfile === null) await dependencies.clearProfile();
    else await dependencies.saveProfile(nextProfile);
    dependencies.invalidateRuntime();
    dependencies.bootstrapSession();
  };

  return {
    plan,
    replace: async (currentProfile, nextProfile) => {
      const resetPlan = plan(currentProfile, nextProfile);
      if (resetPlan === null) {
        await persist(nextProfile);
        return { profile: nextProfile, remoteSignOut: "not-required" };
      }

      const result = await executeHubDomainResetPlan(resetPlan, {
        attemptRemoteSignOut: async () => {
          if (!dependencies.hostedAvailable() || dependencies.accountStatus() !== "authenticated") {
            return;
          }
          await dependencies.signOut();
          if (dependencies.accountStatus() === "authenticated") {
            throw new Error("remote sign-out unavailable");
          }
        },
        clearLocalHubState: async () => {
          if (dependencies.hostedAvailable() && dependencies.accountStatus() !== "signed-out") {
            await dependencies.expireSession();
          }
          await dependencies.clearSessionToken();
          if (resetPlan.fromOrigin !== null) {
            await dependencies.forgetHubOrigin(resetPlan.fromOrigin);
          }
        },
        replaceProfile: () => persist(nextProfile),
      });
      return { profile: nextProfile, remoteSignOut: result.remoteSignOut };
    },
  };
}

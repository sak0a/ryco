import {
  verifyCrossDeviceApprovalQr,
  type CrossDeviceApproval,
  type VerifyCrossDeviceApprovalQrInput,
} from "@ryco/shared/relayE2eeCrossDeviceApproval";

export const NATIVE_TRUST_APPROVAL_TTL_MS = 5 * 60 * 1_000;

export type NativeTrustOnboardingStage =
  | "idle"
  | "requesting-approval"
  | "waiting-for-approval"
  | "approval-ready"
  | "scanning"
  | "verifying"
  | "reconnecting"
  | "ready"
  | "recovery-required"
  | "failed";

export type NativeTrustFailure =
  | "approval-expired"
  | "approval-mismatch"
  | "approval-unavailable"
  | "reconnect-failed";

export interface NativeTrustOnboardingTarget {
  readonly environmentId: string;
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly nodeId: string;
  readonly clientFingerprint: string;
  readonly requestedRole: string;
}

export interface NativeTrustOnboardingState {
  readonly stage: NativeTrustOnboardingStage;
  readonly target: NativeTrustOnboardingTarget | null;
  readonly approvalExpiresAt: number | null;
  readonly failure: NativeTrustFailure | null;
}

export type NativeTrustOnboardingEvent =
  | { readonly type: "begin"; readonly target: NativeTrustOnboardingTarget }
  | { readonly type: "approval-requested" }
  | { readonly type: "approval-ready"; readonly expiresAt: number; readonly now: number }
  | { readonly type: "start-scan"; readonly now: number }
  | { readonly type: "scan-read" }
  | { readonly type: "approval-verified" }
  | { readonly type: "channel-ready" }
  | { readonly type: "approval-expired" }
  | { readonly type: "reconnect-failed" }
  | { readonly type: "use-recovery" }
  | { readonly type: "retry" }
  | { readonly type: "cancel" };

export const INITIAL_NATIVE_TRUST_ONBOARDING_STATE: NativeTrustOnboardingState = {
  stage: "idle",
  target: null,
  approvalExpiresAt: null,
  failure: null,
};

function failed(
  state: NativeTrustOnboardingState,
  failure: NativeTrustFailure,
): NativeTrustOnboardingState {
  return { ...state, stage: "failed", failure };
}

function approvalCurrent(state: NativeTrustOnboardingState, now: number): boolean {
  return (
    Number.isSafeInteger(now) &&
    now >= 0 &&
    state.approvalExpiresAt !== null &&
    state.approvalExpiresAt > now
  );
}

/**
 * The native onboarding transition table shared by Desktop and mobile.
 * Unexpected events are fail-closed no-ops, so a delayed callback from an old
 * screen cannot advance a newer target's ceremony.
 */
export function reduceNativeTrustOnboarding(
  state: NativeTrustOnboardingState,
  event: NativeTrustOnboardingEvent,
): NativeTrustOnboardingState {
  if (event.type === "cancel") return INITIAL_NATIVE_TRUST_ONBOARDING_STATE;
  if (event.type === "use-recovery") {
    return state.target === null
      ? state
      : { ...state, stage: "recovery-required", approvalExpiresAt: null, failure: null };
  }
  if (event.type === "begin") {
    return {
      stage: "requesting-approval",
      target: event.target,
      approvalExpiresAt: null,
      failure: null,
    };
  }
  if (event.type === "approval-expired") {
    return state.target === null
      ? state
      : {
          ...state,
          stage: "waiting-for-approval",
          approvalExpiresAt: null,
          failure: "approval-expired",
        };
  }
  if (event.type === "retry") {
    return state.target === null
      ? state
      : {
          ...state,
          stage: "requesting-approval",
          approvalExpiresAt: null,
          failure: null,
        };
  }
  if (event.type === "reconnect-failed") {
    return state.stage === "reconnecting" ? failed(state, "reconnect-failed") : state;
  }

  switch (state.stage) {
    case "requesting-approval":
      return event.type === "approval-requested"
        ? { ...state, stage: "waiting-for-approval", failure: null }
        : state;
    case "waiting-for-approval":
      if (
        event.type !== "approval-ready" ||
        !Number.isSafeInteger(event.expiresAt) ||
        event.expiresAt <= event.now ||
        event.expiresAt - event.now > NATIVE_TRUST_APPROVAL_TTL_MS
      ) {
        return event.type === "approval-ready" ? failed(state, "approval-expired") : state;
      }
      return {
        ...state,
        stage: "approval-ready",
        approvalExpiresAt: event.expiresAt,
        failure: null,
      };
    case "approval-ready":
      if (event.type !== "start-scan") return state;
      return approvalCurrent(state, event.now)
        ? { ...state, stage: "scanning", failure: null }
        : {
            ...state,
            stage: "waiting-for-approval",
            approvalExpiresAt: null,
            failure: "approval-expired",
          };
    case "scanning":
      return event.type === "scan-read" ? { ...state, stage: "verifying" } : state;
    case "verifying":
      return event.type === "approval-verified" ? { ...state, stage: "reconnecting" } : state;
    case "reconnecting":
      return event.type === "channel-ready" ? { ...state, stage: "ready", failure: null } : state;
    default:
      return state;
  }
}

export type NativeTrustApprovalVerification =
  | { readonly ok: true; readonly approval: CrossDeviceApproval }
  | { readonly ok: false; readonly failure: "approval-mismatch" };

/** Verify every v1 binding plus the authority the Ryco native client needs. */
export function verifyNativeTrustApprovalQr(
  input: VerifyCrossDeviceApprovalQrInput & {
    readonly requiredRole?: string;
    readonly requiredCapability?: string;
  },
): NativeTrustApprovalVerification {
  const approval = verifyCrossDeviceApprovalQr(input);
  if (
    approval === undefined ||
    (input.requiredRole !== undefined && approval.maxRole !== input.requiredRole) ||
    (input.requiredCapability !== undefined &&
      !approval.capabilitySet.includes(input.requiredCapability))
  ) {
    return { ok: false, failure: "approval-mismatch" };
  }
  return { ok: true, approval };
}

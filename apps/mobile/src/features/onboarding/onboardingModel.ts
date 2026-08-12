import type { OnboardingProgress, OnboardingProgressStatus } from "./onboardingProgress";

export type OnboardingScreen =
  | "loading"
  | "hub-selection"
  | "account-choice"
  | "browser-handoff"
  | "recovery-codes"
  | "connected";

export type HubSetupStatus =
  | "editing"
  | "checking"
  | "compatible"
  | "invalid"
  | "incompatible"
  | "unreachable"
  | "saving"
  | "save-failed";

export type PublicSignupStatus = "idle" | "checking" | "enabled" | "disabled" | "unreachable";
export type OnboardingAccountIntent = "create-account" | "sign-in" | null;
export type NativeAuthorizationPhase = "idle" | "opening" | "waiting" | "cancelled";
export type OnboardingAccountStatus =
  | "signed-out"
  | "first-run"
  | "authenticating"
  | "authenticated"
  | "unavailable"
  | "session-expired"
  | "signing-out";
export type OnboardingDirectoryStatus = "idle" | "loading" | "ready" | "error";
export type OnboardingCompletionStatus = "idle" | "saving" | "error";

export type OnboardingErrorCode =
  | "hub-required"
  | "hub-invalid-url"
  | "hub-incompatible"
  | "hub-unreachable"
  | "hub-save-failed"
  | "signup-unreachable"
  | "completion-save-failed";

const ERROR_MESSAGES: Readonly<Record<OnboardingErrorCode, string>> = {
  "hub-required": "Enter the full Hub domain.",
  "hub-invalid-url": "Enter a valid Hub origin using HTTPS, without a path or credentials.",
  "hub-incompatible": "This Hub does not advertise the supported mobile browser handoff.",
  "hub-unreachable": "Ryco could not reach this Hub. Check the domain or connection and try again.",
  "hub-save-failed": "Ryco could not save this Hub safely. Your current setup remains active.",
  "signup-unreachable": "Ryco could not check account creation. You can retry or sign in.",
  "completion-save-failed": "Ryco could not finish setup. Try again before leaving this screen.",
};

export type OnboardingActionId =
  | "check-hub"
  | "save-hub"
  | "pair-device"
  | "create-account"
  | "sign-in"
  | "retry-signup"
  | "edit-hub"
  | "cancel-authentication"
  | "retry-authentication"
  | "acknowledge-recovery-codes"
  | "retry-directory"
  | "retry-completion"
  | "go-inbox"
  | "view-nodes";

export interface OnboardingAction {
  readonly id: OnboardingActionId;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly disabled: boolean;
}

export interface OnboardingSnapshot {
  readonly startupReady: boolean;
  readonly storedHub: { readonly origin: string; readonly label: string } | null;
  readonly buildDefaultOrigin: string | null;
  readonly hubDraftOrigin: string;
  readonly hubEditorActive: boolean;
  readonly hubSetupStatus: HubSetupStatus;
  readonly hubError: OnboardingErrorCode | null;
  readonly signupStatus: PublicSignupStatus;
  readonly accountIntent: OnboardingAccountIntent;
  readonly hostedAvailable: boolean;
  readonly hostedPreparationPending?: boolean;
  readonly accountStatus: OnboardingAccountStatus;
  readonly browserPhase: NativeAuthorizationPhase;
  readonly recoveryCodeCount: number;
  readonly accountDisplayName: string | null;
  readonly directoryStatus: OnboardingDirectoryStatus;
  readonly authorizedNodeCount: number;
  readonly runtimeErrorMessage: string | null;
  readonly completionStatus: OnboardingCompletionStatus;
}

export interface OnboardingView {
  readonly screen: OnboardingScreen;
  readonly title: string;
  readonly detail: string;
  readonly errorMessage: string | null;
  readonly hubOrigin: string;
  readonly hubLabel: string | null;
  readonly intent: OnboardingAccountIntent;
  readonly actions: ReadonlyArray<OnboardingAction>;
}

function action(
  id: OnboardingActionId,
  label: string,
  options: { readonly disabled?: boolean; readonly accessibilityLabel?: string } = {},
): OnboardingAction {
  return {
    id,
    label,
    accessibilityLabel: options.accessibilityLabel ?? label,
    disabled: options.disabled ?? false,
  };
}

function boundedRuntimeError(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.length <= 180 ? trimmed : `${trimmed.slice(0, 179)}…`;
}

export function onboardingErrorMessage(code: OnboardingErrorCode): string {
  return ERROR_MESSAGES[code];
}

export function deriveOnboardingMigration(input: {
  readonly progress: OnboardingProgress | null;
  readonly hasStoredHub: boolean;
  readonly directEnvironmentCount: number;
  readonly hostedAuthenticated: boolean;
}): OnboardingProgressStatus {
  if (input.progress !== null) return input.progress.status;
  return input.hasStoredHub || input.directEnvironmentCount > 0 || input.hostedAuthenticated
    ? "completed"
    : "in-progress";
}

export function initialHubOrigin(input: {
  readonly storedHubOrigin: string | null;
  readonly buildDefaultOrigin: string | null;
}): string {
  return input.storedHubOrigin ?? input.buildDefaultOrigin ?? "";
}

function base(
  snapshot: OnboardingSnapshot,
  view: Omit<OnboardingView, "hubOrigin" | "hubLabel" | "intent">,
): OnboardingView {
  return {
    ...view,
    hubOrigin:
      snapshot.hubDraftOrigin || snapshot.storedHub?.origin || snapshot.buildDefaultOrigin || "",
    hubLabel: snapshot.storedHub?.label ?? null,
    intent: snapshot.accountIntent,
  };
}

function deriveHubSelection(snapshot: OnboardingSnapshot): OnboardingView {
  const checking = snapshot.hubSetupStatus === "checking";
  const saving = snapshot.hubSetupStatus === "saving";
  const compatible = snapshot.hubSetupStatus === "compatible";
  const primary = compatible
    ? action("save-hub", "Save Hub", { disabled: saving })
    : action("check-hub", checking ? "Checking compatibility…" : "Check compatibility", {
        disabled: checking || saving,
      });
  const modelError = snapshot.hubError ? onboardingErrorMessage(snapshot.hubError) : null;
  return base(snapshot, {
    screen: "hub-selection",
    title: snapshot.storedHub ? "Choose another Hub" : "Connect your Ryco Hub",
    detail:
      "Choose the Hub that owns your account and authorized nodes. Ryco checks it before saving anything.",
    errorMessage: modelError ?? boundedRuntimeError(snapshot.runtimeErrorMessage),
    actions: [primary, action("pair-device", "Pair a device instead")],
  });
}

function signupDetail(status: PublicSignupStatus): string {
  switch (status) {
    case "enabled":
      return "Create a new Hub account or sign in to an existing one. The Hub handles both in your system browser.";
    case "disabled":
      return "This Hub is not accepting public signups. An owner can invite you, or you can sign in to an existing account.";
    case "unreachable":
      return "Ryco could not confirm public signup availability. Sign-in still uses the Hub-owned browser flow.";
    case "checking":
    case "idle":
      return "Ryco is checking which account paths this Hub currently offers.";
  }
}

function deriveAccountChoice(snapshot: OnboardingSnapshot): OnboardingView {
  const createEnabled = snapshot.hostedAvailable && snapshot.signupStatus === "enabled";
  const hostedDisabled = !snapshot.hostedAvailable;
  const hostedUnavailable = hostedDisabled && !snapshot.hostedPreparationPending;
  const actions: OnboardingAction[] = [
    action(
      "create-account",
      snapshot.signupStatus === "checking" ? "Checking account creation…" : "Create account",
      { disabled: !createEnabled, accessibilityLabel: "Create a Hub account" },
    ),
    action("sign-in", "Sign in", {
      disabled: hostedDisabled,
      accessibilityLabel: "Sign in to an existing Hub account",
    }),
  ];
  if (snapshot.signupStatus === "unreachable") {
    actions.push(action("retry-signup", "Retry account check"));
  }
  actions.push(action("edit-hub", "Change Hub"), action("pair-device", "Pair a device instead"));

  const errorMessage = hostedUnavailable
    ? "This device could not create the hardware-backed key required for a Hub session. Direct pairing still works."
    : snapshot.signupStatus === "unreachable"
      ? onboardingErrorMessage("signup-unreachable")
      : boundedRuntimeError(snapshot.runtimeErrorMessage);
  return base(snapshot, {
    screen: "account-choice",
    title: "Continue with your account",
    detail: snapshot.hostedPreparationPending
      ? "Ryco is preparing this device's secure Hub session."
      : signupDetail(snapshot.signupStatus),
    errorMessage,
    actions,
  });
}

function deriveBrowser(snapshot: OnboardingSnapshot): OnboardingView {
  if (snapshot.browserPhase === "cancelled") {
    return base(snapshot, {
      screen: "browser-handoff",
      title: "Browser sign-in cancelled",
      detail: "Nothing was saved from that authorization attempt. Try again when you are ready.",
      errorMessage: boundedRuntimeError(snapshot.runtimeErrorMessage),
      actions: [
        action("retry-authentication", "Try again"),
        action("edit-hub", "Back to Hub setup"),
      ],
    });
  }
  const opening = snapshot.browserPhase === "opening";
  return base(snapshot, {
    screen: "browser-handoff",
    title: opening ? "Opening your Hub" : "Continue in your browser",
    detail: opening
      ? "Ryco is preparing a secure system-browser authorization request."
      : snapshot.accountIntent === "create-account"
        ? "Choose Create account in the Hub page, finish its steps, then approve this device."
        : "Finish signing in on the Hub page, then approve this device. Ryco returns automatically.",
    errorMessage: boundedRuntimeError(snapshot.runtimeErrorMessage),
    actions: [action("cancel-authentication", "Cancel browser sign-in")],
  });
}

function deriveConnected(snapshot: OnboardingSnapshot): OnboardingView {
  const count = Math.max(0, snapshot.authorizedNodeCount);
  const directoryDetail =
    snapshot.directoryStatus === "loading" || snapshot.directoryStatus === "idle"
      ? "Ryco is refreshing your authorized Hub nodes."
      : snapshot.directoryStatus === "error"
        ? "Your account is connected, but the node directory could not be refreshed."
        : `${String(count)} authorized ${count === 1 ? "node" : "nodes"} available.`;
  const actions: OnboardingAction[] = [];
  if (snapshot.directoryStatus === "error") actions.push(action("retry-directory", "Retry nodes"));
  if (snapshot.completionStatus === "error") {
    actions.push(action("retry-completion", "Retry finishing setup"));
  }
  const finishing = snapshot.completionStatus === "saving";
  actions.push(
    action("go-inbox", finishing ? "Finishing…" : "Go to Inbox", { disabled: finishing }),
    action("view-nodes", "View Nodes", { disabled: finishing }),
  );
  return base(snapshot, {
    screen: "connected",
    title: snapshot.accountDisplayName
      ? `You're connected, ${snapshot.accountDisplayName}`
      : "You're connected",
    detail: directoryDetail,
    errorMessage:
      snapshot.completionStatus === "error"
        ? onboardingErrorMessage("completion-save-failed")
        : boundedRuntimeError(snapshot.runtimeErrorMessage),
    actions,
  });
}

export function deriveOnboardingView(snapshot: OnboardingSnapshot): OnboardingView {
  if (!snapshot.startupReady) {
    return base(snapshot, {
      screen: "loading",
      title: "Preparing Ryco",
      detail: "Checking your saved connections and Hub session.",
      errorMessage: null,
      actions: [],
    });
  }
  if (snapshot.recoveryCodeCount > 0) {
    return base(snapshot, {
      screen: "recovery-codes",
      title: "Save your recovery codes",
      detail: "These one-time codes remain visible until you confirm that you saved them.",
      errorMessage: null,
      actions: [action("acknowledge-recovery-codes", "I saved the codes")],
    });
  }
  if (snapshot.browserPhase !== "idle" || snapshot.accountStatus === "authenticating") {
    return deriveBrowser(snapshot);
  }
  let view: OnboardingView;
  if (snapshot.hubEditorActive || snapshot.storedHub === null) view = deriveHubSelection(snapshot);
  else if (snapshot.accountStatus === "authenticated") view = deriveConnected(snapshot);
  else view = deriveAccountChoice(snapshot);

  if (snapshot.completionStatus === "error" && view.screen !== "connected") {
    return {
      ...view,
      errorMessage: onboardingErrorMessage("completion-save-failed"),
      actions: [action("retry-completion", "Retry finishing setup"), ...view.actions],
    };
  }
  if (snapshot.completionStatus === "saving") {
    return {
      ...view,
      actions: view.actions.map((current) => ({ ...current, disabled: true })),
    };
  }
  return view;
}

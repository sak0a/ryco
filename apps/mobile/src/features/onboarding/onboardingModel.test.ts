import { describe, expect, it } from "vite-plus/test";

import {
  deriveOnboardingMigration,
  deriveOnboardingView,
  initialHubOrigin,
  onboardingErrorMessage,
  type OnboardingSnapshot,
} from "./onboardingModel";

function snapshot(overrides: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot {
  return {
    startupReady: true,
    storedHub: null,
    buildDefaultOrigin: null,
    hubDraftOrigin: "",
    hubEditorActive: false,
    hubSetupStatus: "editing",
    hubError: null,
    signupStatus: "idle",
    accountIntent: null,
    hostedAvailable: true,
    accountStatus: "signed-out",
    browserPhase: "idle",
    recoveryCodeCount: 0,
    accountDisplayName: null,
    directoryStatus: "idle",
    authorizedNodeCount: 0,
    runtimeErrorMessage: null,
    completionStatus: "idle",
    ...overrides,
  };
}

describe("onboarding migration", () => {
  it("preserves an existing marker and completes migration for every prior-use signal", () => {
    expect(
      deriveOnboardingMigration({
        progress: { version: 1, status: "in-progress" },
        hasStoredHub: true,
        directEnvironmentCount: 2,
        hostedAuthenticated: true,
      }),
    ).toBe("in-progress");

    for (const priorUse of [
      { hasStoredHub: true, directEnvironmentCount: 0, hostedAuthenticated: false },
      { hasStoredHub: false, directEnvironmentCount: 1, hostedAuthenticated: false },
      { hasStoredHub: false, directEnvironmentCount: 0, hostedAuthenticated: true },
    ]) {
      expect(deriveOnboardingMigration({ progress: null, ...priorUse })).toBe("completed");
    }
  });

  it("starts a genuinely fresh install in progress", () => {
    expect(
      deriveOnboardingMigration({
        progress: null,
        hasStoredHub: false,
        directEnvironmentCount: 0,
        hostedAuthenticated: false,
      }),
    ).toBe("in-progress");
  });

  it("prefers a stored profile, then the build default, then an empty draft", () => {
    expect(
      initialHubOrigin({
        storedHubOrigin: "https://saved.example.test",
        buildDefaultOrigin: "https://build.example.test",
      }),
    ).toBe("https://saved.example.test");
    expect(
      initialHubOrigin({ storedHubOrigin: null, buildDefaultOrigin: "https://build.example.test" }),
    ).toBe("https://build.example.test");
    expect(initialHubOrigin({ storedHubOrigin: null, buildDefaultOrigin: null })).toBe("");
  });
});

describe("onboarding view", () => {
  it("shows first-run Hub selection with build-default prefill and direct escape", () => {
    const view = deriveOnboardingView(
      snapshot({
        buildDefaultOrigin: "https://build.example.test",
        hubDraftOrigin: "https://build.example.test",
      }),
    );

    expect(view.screen).toBe("hub-selection");
    expect(view.hubOrigin).toBe("https://build.example.test");
    expect(view.actions.map((action) => action.id)).toEqual(["check-hub", "pair-device"]);
  });

  it("keeps invalid, incompatible, and unreachable drafts retryable", () => {
    for (const [status, error] of [
      ["invalid", "hub-invalid-url"],
      ["incompatible", "hub-incompatible"],
      ["unreachable", "hub-unreachable"],
    ] as const) {
      const view = deriveOnboardingView(
        snapshot({
          hubDraftOrigin: "https://draft.example.test",
          hubSetupStatus: status,
          hubError: error,
        }),
      );
      expect(view.screen).toBe("hub-selection");
      expect(view.hubOrigin).toBe("https://draft.example.test");
      expect(view.errorMessage).toBe(onboardingErrorMessage(error));
      expect(view.actions.some((action) => action.id === "check-hub")).toBe(true);
    }
  });

  it("requires an exact compatible check before save", () => {
    const checking = deriveOnboardingView(snapshot({ hubSetupStatus: "checking" }));
    const compatible = deriveOnboardingView(snapshot({ hubSetupStatus: "compatible" }));

    expect(checking.actions[0]).toMatchObject({ id: "check-hub", disabled: true });
    expect(compatible.actions[0]).toMatchObject({ id: "save-hub", disabled: false });
  });

  it("presents honest create and sign-in actions for live signup states", () => {
    const storedHub = { origin: "https://hub.example.test", label: "Studio Hub" };
    const enabled = deriveOnboardingView(snapshot({ storedHub, signupStatus: "enabled" }));
    const disabled = deriveOnboardingView(snapshot({ storedHub, signupStatus: "disabled" }));
    const unavailable = deriveOnboardingView(snapshot({ storedHub, signupStatus: "unreachable" }));

    expect(enabled.screen).toBe("account-choice");
    expect(enabled.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "create-account", disabled: false }),
        expect.objectContaining({ id: "sign-in", disabled: false }),
      ]),
    );
    expect(disabled.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "create-account", disabled: true }),
        expect.objectContaining({ id: "sign-in", disabled: false }),
      ]),
    );
    expect(unavailable.actions.map((action) => action.id)).toContain("retry-signup");
    expect(unavailable.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "sign-in", disabled: false })]),
    );
  });

  it("distinguishes opening, waiting, cancellation, and retry without carrying browser data", () => {
    const storedHub = { origin: "https://hub.example.test", label: "Studio Hub" };
    expect(deriveOnboardingView(snapshot({ storedHub, browserPhase: "opening" })).title).toBe(
      "Opening your Hub",
    );
    expect(deriveOnboardingView(snapshot({ storedHub, browserPhase: "waiting" })).title).toBe(
      "Continue in your browser",
    );
    const cancelled = deriveOnboardingView(snapshot({ storedHub, browserPhase: "cancelled" }));
    expect(cancelled.screen).toBe("browser-handoff");
    expect(cancelled.actions.map((action) => action.id)).toEqual([
      "retry-authentication",
      "edit-hub",
    ]);
    expect(JSON.stringify(cancelled)).not.toContain("callback");
  });

  it("shows connected directory states and completes only through explicit exits", () => {
    const connected = deriveOnboardingView(
      snapshot({
        storedHub: { origin: "https://hub.example.test", label: "Studio Hub" },
        accountStatus: "authenticated",
        accountDisplayName: "Ada",
        directoryStatus: "ready",
        authorizedNodeCount: 3,
      }),
    );
    expect(connected.screen).toBe("connected");
    expect(connected.detail).toContain("3 authorized nodes");
    expect(connected.actions.map((action) => action.id)).toEqual(["go-inbox", "view-nodes"]);

    const failed = deriveOnboardingView(
      snapshot({
        storedHub: { origin: "https://hub.example.test", label: "Studio Hub" },
        accountStatus: "authenticated",
        directoryStatus: "error",
      }),
    );
    expect(failed.actions.map((action) => action.id)).toEqual([
      "retry-directory",
      "go-inbox",
      "view-nodes",
    ]);
  });

  it("gives recovery codes precedence over browser, errors, and completion", () => {
    const view = deriveOnboardingView(
      snapshot({
        storedHub: { origin: "https://hub.example.test", label: "Studio Hub" },
        accountStatus: "authenticated",
        browserPhase: "waiting",
        recoveryCodeCount: 2,
        runtimeErrorMessage: "Something failed",
      }),
    );
    expect(view.screen).toBe("recovery-codes");
    expect(view.actions.map((action) => action.id)).toEqual(["acknowledge-recovery-codes"]);
  });

  it("disables hosted actions when hardware-backed hosted mode is unavailable", () => {
    const view = deriveOnboardingView(
      snapshot({
        storedHub: { origin: "https://hub.example.test", label: "Studio Hub" },
        signupStatus: "enabled",
        hostedAvailable: false,
        accountStatus: "unavailable",
      }),
    );
    expect(view.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "create-account", disabled: true }),
        expect.objectContaining({ id: "sign-in", disabled: true }),
        expect.objectContaining({ id: "pair-device", disabled: false }),
      ]),
    );
  });

  it("keeps every model-owned error and accessibility label bounded", () => {
    const codes = [
      "hub-required",
      "hub-invalid-url",
      "hub-incompatible",
      "hub-unreachable",
      "hub-save-failed",
      "signup-unreachable",
      "completion-save-failed",
    ] as const;
    for (const code of codes) expect(onboardingErrorMessage(code).length).toBeLessThanOrEqual(180);

    const view = deriveOnboardingView(
      snapshot({ runtimeErrorMessage: "x".repeat(1_000), hubError: "hub-unreachable" }),
    );
    expect(view.errorMessage?.length).toBeLessThanOrEqual(180);
    for (const action of view.actions) {
      expect(action.accessibilityLabel.length).toBeGreaterThan(0);
      expect(action.accessibilityLabel.length).toBeLessThanOrEqual(80);
    }
  });
});

import {
  HostedHubApiError,
  PASSKEY_SESSION_REQUIRED_CODE,
  STEP_UP_REQUIRED_CODE,
  type HostedAccountState,
  type HostedHubPasskey,
  type HostedHubState,
} from "@ryco/client-runtime/authorization";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createHostedAccountPromptDraft,
  deriveHostedAccountManagementView,
  isHostedPasskeySessionMessage,
  isHostedStepUpMessage,
  type HostedAccountActions,
  type HostedAccountManagementView,
  type HostedAccountPromptDraft,
  type HostedAccountPromptId,
  type HostedAccountPromptView,
} from "./hostedAccountModel";

/**
 * The runtime's real refusal text, built the way the runtime builds it. The
 * controller only ever publishes `HostedHubApiError.message`, so these are the
 * exact strings the account store carries on a refusal.
 */
const STEP_UP_MESSAGE = new HostedHubApiError(STEP_UP_REQUIRED_CODE, 403).message;
const PASSKEY_SESSION_MESSAGE = new HostedHubApiError(PASSKEY_SESSION_REQUIRED_CODE, 403).message;

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function passkey(overrides: Partial<HostedHubPasskey> = {}): HostedHubPasskey {
  return {
    id: "pkey_01J8ZQ5V2N7X0000000000",
    label: "Studio Mac",
    createdAt: NOW - 20 * DAY,
    lastUsedAt: NOW - 2 * HOUR,
    backupEligible: true,
    backupState: true,
    revokedAt: null,
    revocationReasonCode: null,
    ...overrides,
  };
}

function hubState(overrides: Partial<HostedHubState> = {}): HostedHubState {
  return {
    bootstrapAvailable: false,
    accountStatus: "authenticated",
    account: {
      id: "acct_01J8ZQ5V2N7X0000000000",
      displayName: "Ada Lovelace",
      role: "owner",
      createdAt: 1_700_000_000_000,
      disabledAt: null,
    },
    session: {
      id: "sess_01J8ZQ5V2N7X1111111111",
      accountId: "acct_01J8ZQ5V2N7X0000000000",
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_003_600_000,
      lastSeenAt: 1_700_000_060_000,
      revokedAt: null,
      revocationReasonCode: null,
    },
    directoryStatus: "ready",
    nodes: [],
    selectedNode: null,
    selectionStatus: "none",
    effectiveRole: null,
    transportStatus: "idle",
    sessionStatus: "closed",
    sessionEstablished: false,
    sessionRecoveredAfterUnknown: false,
    browserStatus: "current",
    recoveryCodes: [],
    totpEnrollment: null,
    errorMessage: null,
    generation: 0,
    ...overrides,
  };
}

function accountState(overrides: Partial<HostedAccountState> = {}): HostedAccountState {
  return {
    passkeys: [passkey()],
    passkeysStatus: "ready",
    actionStatus: "idle",
    errorMessage: null,
    ...overrides,
  };
}

/** Every button press is fire-and-forget, so a settled press needs a flush. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Harness {
  readonly view: () => HostedAccountManagementView;
  readonly prompt: () => HostedAccountPromptView;
  readonly open: (id: HostedAccountPromptId) => void;
  readonly type: (patch: Partial<HostedAccountPromptDraft>) => void;
  readonly draft: () => HostedAccountPromptDraft | null;
  readonly actions: {
    [K in keyof HostedAccountActions]: ReturnType<typeof vi.fn>;
  };
  readonly setAccount: (patch: Partial<HostedAccountState>) => void;
  /** The store error the *next* controller call publishes. */
  readonly nextOutcome: (message: string | null) => void;
}

function harness(initial?: {
  readonly hub?: Partial<HostedHubState>;
  readonly account?: Partial<HostedAccountState>;
}): Harness {
  let hub = hubState(initial?.hub);
  let account = accountState(initial?.account);
  let draft: HostedAccountPromptDraft | null = null;
  const outcomes: Array<string | null> = [];

  /** Every controller fake settles the store the way the controller would. */
  const commit = () => {
    const message = outcomes.length > 0 ? outcomes.shift()! : null;
    account = { ...account, errorMessage: message };
  };

  const actions = {
    refreshPasskeys: vi.fn(),
    addPasskey: vi.fn(async () => commit()),
    revokePasskey: vi.fn(async () => commit()),
    regenerateRecoveryCodes: vi.fn(async () => commit()),
    setPassword: vi.fn(async () => commit()),
    removePassword: vi.fn(async () => commit()),
    beginTotpEnrollment: vi.fn(async () => {
      commit();
      if (account.errorMessage === null) {
        hub = {
          ...hub,
          totpEnrollment: {
            secretBase32: "JBSWY3DPEHPK3PXP",
            provisioningUri:
              "otpauth://totp/Ryco:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Ryco",
          },
        };
      }
    }),
    confirmTotpEnrollment: vi.fn(async () => {
      commit();
      if (account.errorMessage === null) hub = { ...hub, totpEnrollment: null };
    }),
    revokeTotp: vi.fn(async () => commit()),
    requestEmailVerification: vi.fn(async () => commit()),
    dismissTotpEnrollment: vi.fn(() => {
      hub = { ...hub, totpEnrollment: null };
    }),
    cancelAccountAction: vi.fn(),
  };

  const view = () =>
    deriveHostedAccountManagementView({
      state: hub,
      accountState: account,
      draft,
      actions: actions as unknown as HostedAccountActions,
      readAccountState: () => account,
      onDraftChange: (next) => {
        draft = next;
      },
      now: NOW,
    });

  return {
    view,
    prompt: () => {
      const current = view().prompt;
      if (current === null) throw new Error("expected an open prompt");
      return current;
    },
    open: (id) => {
      draft = createHostedAccountPromptDraft(id);
    },
    type: (patch) => {
      if (draft === null) throw new Error("no draft");
      draft = { ...draft, ...patch };
    },
    draft: () => draft,
    actions,
    setAccount: (patch) => {
      account = { ...account, ...patch };
    },
    nextOutcome: (message) => {
      outcomes.push(message);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hosted account management surface", () => {
  it("renders nothing to manage without an authenticated session", () => {
    for (const patch of [
      { accountStatus: "signed-out" as const },
      { accountStatus: "session-expired" as const },
      { accountStatus: "authenticated" as const, account: null },
    ]) {
      const view = harness({ hub: patch }).view();
      expect(view.available).toBe(false);
      expect(view.sections).toEqual([]);
      expect(view.passkeyRows).toEqual([]);
      expect(view.prompt).toBeNull();
    }
  });

  it("offers every capability the runtime now exposes, natively", () => {
    const view = harness().view();
    expect(view.sections.map((section) => section.id)).toEqual([
      "passkeys",
      "recovery-codes",
      "password",
      "two-factor",
      "email",
    ]);
    expect(view.sections.flatMap((section) => section.rows.map((row) => row.id))).toEqual([
      "add-passkey",
      "regenerate-recovery-codes",
      "set-password",
      "remove-password",
      "enroll-totp",
      "revoke-totp",
      "verify-email",
    ]);
  });

  /**
   * The one thing a mount must never do. Regenerating recovery codes rotates
   * them — every code the user saved stops working — so nothing that merely
   * *renders* the surface may reach a controller action.
   */
  it("calls no controller action from a derivation", () => {
    const test = harness();
    const view = test.view();
    // Deriving with a prompt open, and with one mid-flight, must be inert too.
    test.open("regenerate-recovery-codes");
    test.view();
    test.setAccount({ actionStatus: "regenerating-recovery-codes" });
    test.view();
    for (const [name, fake] of Object.entries(test.actions)) {
      expect(fake, `derivation called ${name}`).not.toHaveBeenCalled();
    }
    expect(view.sections.length).toBeGreaterThan(0);
  });

  it("refuses every row while another account change is in flight, at the model layer", () => {
    const test = harness({ account: { actionStatus: "setting-password" } });
    const view = test.view();
    expect(view.busy).toBe(true);
    for (const section of view.sections) {
      for (const row of section.rows) {
        expect(row.disabled, row.id).toBe(true);
        // Not merely greyed out: pressing it anyway opens nothing.
        row.run();
      }
    }
    expect(test.draft()).toBeNull();
  });
});

describe("passkey rows", () => {
  it("lists revoked credentials rather than hiding them", () => {
    const view = harness({
      account: {
        passkeys: [
          passkey({ id: "pkey_01J8ZQ5V2N7X0000000001", label: "Old laptop", revokedAt: NOW - DAY }),
          passkey({ id: "pkey_01J8ZQ5V2N7X0000000002", label: "iPhone" }),
          passkey({ id: "pkey_01J8ZQ5V2N7X0000000003", label: "iPad" }),
        ],
      },
    }).view();
    expect(view.passkeyRows.map((row) => row.label)).toEqual(["Old laptop", "iPhone", "iPad"]);
    expect(view.passkeyRows[0]?.revoked).toBe(true);
    expect(view.passkeyRows[0]?.detail).toBe("Revoked 1d ago");
    expect(view.passkeyRows[0]?.tone?.label).toBe("Revoked");
    // A revoked credential cannot be revoked again.
    expect(view.passkeyRows[0]?.revoke).toBeUndefined();
    expect(view.passkeyRows[1]?.detail).toBe("Added 20d ago · Last used 2h ago");
  });

  it("names an unlabelled credential and reports one never used", () => {
    const view = harness({
      account: { passkeys: [passkey({ label: null, lastUsedAt: null, backupState: false })] },
    }).view();
    expect(view.passkeyRows[0]?.label).toBe("Unnamed passkey");
    expect(view.passkeyRows[0]?.detail).toBe("Added 20d ago · Never used");
    expect(view.passkeyRows[0]?.tone?.label).toBe("This device only");
  });

  it("withholds the revoke on the last remaining credential, and says why", () => {
    const single = harness().view();
    expect(single.passkeyRows).toHaveLength(1);
    expect(single.passkeyRows[0]?.revoke).toBeUndefined();
    expect(single.sections[0]?.footnote).toContain("only one left");

    const pair = harness({
      account: {
        passkeys: [passkey(), passkey({ id: "pkey_01J8ZQ5V2N7X0000000009", label: "iPhone" })],
      },
    }).view();
    expect(pair.passkeyRows.every((row) => row.revoke !== undefined)).toBe(true);
    expect(pair.sections[0]?.footnote).not.toContain("only one left");
  });

  it("opens a revoke confirmation naming the credential, and never the id", () => {
    const test = harness({
      account: {
        passkeys: [
          passkey({ id: "pkey_01J8ZQ5V2N7X0000000002", label: "iPhone" }),
          passkey({ id: "pkey_01J8ZQ5V2N7X0000000003", label: "iPad" }),
        ],
      },
    });
    test.view().passkeyRows[1]?.revoke?.();
    const prompt = test.prompt();
    expect(prompt.id).toBe("revoke-passkey");
    expect(prompt.destructive).toBe(true);
    expect(prompt.message).toContain("iPad");
    expect(prompt.message).toContain("sign in again");
    expect(test.draft()?.credentialId).toBe("pkey_01J8ZQ5V2N7X0000000003");
  });

  /**
   * The credential handle is a public identifier, but it is an identifier all
   * the same: it belongs in a revoke argument and a list key, never in copy.
   */
  it("renders no credential id", () => {
    const test = harness({
      account: {
        passkeys: [
          passkey({ id: "pkey_01J8ZQ5V2N7X0000000002", label: "iPhone" }),
          passkey({ id: "pkey_01J8ZQ5V2N7X0000000003", label: "iPad" }),
        ],
      },
    });
    test.view().passkeyRows[0]?.revoke?.();
    const view = test.view();
    const rendered = [
      ...view.passkeyRows.flatMap((row) => [row.label, row.detail, row.tone?.label ?? ""]),
      ...view.sections.flatMap((section) => [
        section.title,
        section.footnote,
        ...section.rows.map((row) => row.label),
      ]),
      view.prompt?.title ?? "",
      view.prompt?.message ?? "",
    ].join(" ");
    expect(rendered).not.toContain("pkey_");
  });

  it("revokes through the controller with the credential the row named", async () => {
    const test = harness({
      account: {
        passkeys: [
          passkey({ id: "pkey_01J8ZQ5V2N7X0000000002", label: "iPhone" }),
          passkey({ id: "pkey_01J8ZQ5V2N7X0000000003", label: "iPad" }),
        ],
      },
    });
    test.view().passkeyRows[1]?.revoke?.();
    test.prompt().submit?.run();
    await flush();
    expect(test.actions.revokePasskey).toHaveBeenCalledWith("pkey_01J8ZQ5V2N7X0000000003");
    // The list is the visible outcome, so the prompt gets out of the way.
    expect(test.draft()).toBeNull();
  });
});

describe("adding a passkey", () => {
  it("enrols this device natively, with an optional name", async () => {
    const test = harness();
    test.view().sections[0]?.rows[0]?.run();
    test.type({ text: "  iPhone  " });
    test.prompt().submit?.run();
    await flush();
    expect(test.actions.addPasskey).toHaveBeenCalledWith({ passkeyLabel: "iPhone" });
    expect(test.draft()).toBeNull();
  });

  it("sends no label at all when the field is left blank", async () => {
    const test = harness();
    test.open("add-passkey");
    test.prompt().submit?.run();
    await flush();
    expect(test.actions.addPasskey).toHaveBeenCalledWith({ passkeyLabel: null });
  });

  it("keeps the prompt open and shows the runtime's message when the Hub refuses", async () => {
    const test = harness();
    test.open("add-passkey");
    test.nextOutcome("The passkey could not be verified.");
    test.prompt().submit?.run();
    await flush();
    expect(test.draft()).not.toBeNull();
    expect(test.prompt().errorMessage).toBe("The passkey could not be verified.");
  });

  it("offers a way out of a platform sheet that never returns", () => {
    const test = harness({ account: { actionStatus: "adding-passkey" } });
    test.open("add-passkey");
    const prompt = test.prompt();
    expect(prompt.busy).toBe(true);
    expect(prompt.submit?.disabled).toBe(true);
    expect(prompt.dismiss.disabled).toBe(true);
    prompt.cancel?.run();
    expect(test.actions.cancelAccountAction).toHaveBeenCalledTimes(1);
  });
});

/**
 * The fallback-session step-up.
 *
 * A session minted from a password, a recovery code, or an email link must
 * present a current TOTP code where TOTP is enrolled; a passkey session must
 * not be asked for one. Nothing the client can read says which kind of session
 * it holds, so the action is attempted and only the runtime's own refusal turns
 * the field on.
 */
describe("TOTP step-up", () => {
  it("acts on the runtime's step-up refusal and on nothing else", () => {
    // Pinned deliberately: this is a string comparison against another
    // package's copy, so a reword there must fail here rather than silently
    // disable the step-up prompt.
    expect(STEP_UP_MESSAGE).toBe(
      "Enter a current code from your authenticator app to confirm this change.",
    );
    expect(isHostedStepUpMessage(STEP_UP_MESSAGE)).toBe(true);
    expect(isHostedStepUpMessage(null)).toBe(false);
    // A generic authorization failure is a different thing and must not open a
    // code field the Hub never asked for.
    expect(isHostedStepUpMessage("You are not authorized to perform this action.")).toBe(false);
    expect(isHostedStepUpMessage(PASSKEY_SESSION_MESSAGE)).toBe(false);
    expect(isHostedPasskeySessionMessage(PASSKEY_SESSION_MESSAGE)).toBe(true);
    expect(isHostedPasskeySessionMessage(STEP_UP_MESSAGE)).toBe(false);
    expect(STEP_UP_MESSAGE).not.toBe(PASSKEY_SESSION_MESSAGE);
  });

  it("asks for a code only after the Hub demands one, then retries with it", async () => {
    const test = harness();
    test.open("remove-password");
    // No code is offered up front, and none is sent.
    expect(test.prompt().fields).toEqual([]);
    test.nextOutcome(STEP_UP_MESSAGE);
    test.prompt().submit?.run();
    await flush();
    expect(test.actions.removePassword).toHaveBeenLastCalledWith({});

    const stepped = test.prompt();
    expect(stepped.fields.map((field) => field.key)).toEqual(["stepUpCode"]);
    expect(stepped.errorMessage).toBe(STEP_UP_MESSAGE);
    // The retry is the user's: an empty or short code cannot be submitted.
    expect(stepped.submit?.disabled).toBe(true);
    stepped.submit?.run();
    await flush();
    expect(test.actions.removePassword).toHaveBeenCalledTimes(1);

    test.type({ stepUpCode: "123456" });
    test.prompt().submit?.run();
    await flush();
    expect(test.actions.removePassword).toHaveBeenLastCalledWith({ totpCode: "123456" });
  });

  it("clears a rejected code and keeps the refusal visible", async () => {
    const test = harness();
    test.open("revoke-totp");
    test.nextOutcome(STEP_UP_MESSAGE);
    test.prompt().submit?.run();
    await flush();
    test.type({ stepUpCode: "000000" });
    test.nextOutcome(STEP_UP_MESSAGE);
    test.prompt().submit?.run();
    await flush();
    expect(test.draft()?.stepUpCode).toBe("");
    expect(test.draft()?.stepUpRequired).toBe(true);
    expect(test.prompt().errorMessage).toBe(STEP_UP_MESSAGE);
  });

  it("never offers a code field for a refusal that needs a passkey session", async () => {
    const test = harness();
    test.open("enroll-totp");
    test.nextOutcome(PASSKEY_SESSION_MESSAGE);
    test.prompt().submit?.run();
    await flush();
    const prompt = test.prompt();
    expect(test.draft()?.stepUpRequired).toBe(false);
    expect(prompt.fields).toEqual([]);
    // The runtime's own message is the whole instruction: sign in with a
    // passkey. A code field here would imply a fallback session could stand in.
    expect(prompt.errorMessage).toBe(PASSKEY_SESSION_MESSAGE);
    expect(prompt.errorMessage).toContain("passkey");
  });

  it("carries the step-up on every action the Hub gates with one", async () => {
    const cases: ReadonlyArray<{
      readonly id: HostedAccountPromptId;
      readonly fill?: Partial<HostedAccountPromptDraft>;
      readonly fake: keyof Harness["actions"];
      readonly expected: Record<string, unknown>;
    }> = [
      {
        id: "add-passkey",
        fake: "addPasskey",
        expected: { passkeyLabel: null, totpCode: "111111" },
      },
      {
        id: "regenerate-recovery-codes",
        fake: "regenerateRecoveryCodes",
        expected: { totpCode: "111111" },
      },
      {
        id: "set-password",
        fill: { text: "correct horse battery", secondary: "correct horse battery" },
        fake: "setPassword",
        expected: { password: "correct horse battery", totpCode: "111111" },
      },
      { id: "remove-password", fake: "removePassword", expected: { totpCode: "111111" } },
      { id: "revoke-totp", fake: "revokeTotp", expected: { totpCode: "111111" } },
      {
        id: "verify-email",
        fill: { text: "ada@example.com" },
        fake: "requestEmailVerification",
        expected: { email: "ada@example.com", totpCode: "111111" },
      },
    ];
    for (const scenario of cases) {
      const test = harness();
      test.open(scenario.id);
      if (scenario.fill) test.type(scenario.fill);
      test.nextOutcome(STEP_UP_MESSAGE);
      test.prompt().submit?.run();
      await flush();
      test.type({ stepUpCode: "111111" });
      test.prompt().submit?.run();
      await flush();
      expect(test.actions[scenario.fake], scenario.id).toHaveBeenLastCalledWith(scenario.expected);
    }
  });
});

describe("recovery codes", () => {
  it("states what regeneration destroys before it runs", () => {
    const test = harness();
    const row = test.view().sections.find((section) => section.id === "recovery-codes")?.rows[0];
    expect(row?.destructive).toBe(true);
    row?.run();
    const prompt = test.prompt();
    expect(prompt.destructive).toBe(true);
    expect(prompt.message).toContain("stops working immediately");
    expect(prompt.notice).toContain("no way to undo");
    expect(prompt.submit?.destructive).toBe(true);
    // Opening the confirmation rotates nothing.
    expect(test.actions.regenerateRecoveryCodes).not.toHaveBeenCalled();
  });

  it("rotates only from the explicit submit", async () => {
    const test = harness();
    test.open("regenerate-recovery-codes");
    expect(test.actions.regenerateRecoveryCodes).not.toHaveBeenCalled();
    test.prompt().submit?.run();
    await flush();
    expect(test.actions.regenerateRecoveryCodes).toHaveBeenCalledTimes(1);
    // The new codes land in the hosted store and are displayed by the account
    // view, so the confirmation gets out of the way rather than repeating them.
    expect(test.draft()).toBeNull();
  });
});

describe("password", () => {
  it("never presents a password as equivalent to a passkey", () => {
    const test = harness();
    const section = test.view().sections.find((candidate) => candidate.id === "password");
    expect(section?.footnote).toContain("fallback credential");
    expect(section?.footnote).toContain("weaker than a passkey");
    test.open("set-password");
    expect(test.prompt().message).toContain("fallback, not a replacement");
  });

  it("requires a confirmed, long-enough password before it can be submitted", () => {
    const test = harness();
    test.open("set-password");
    expect(test.prompt().submit?.disabled).toBe(true);

    test.type({ text: "short", secondary: "short" });
    expect(test.prompt().submit?.disabled).toBe(true);

    test.type({ text: "correct horse battery", secondary: "correct horse" });
    expect(test.prompt().submit?.disabled).toBe(true);
    expect(test.prompt().notice).toBe("The two entries do not match.");

    test.type({ text: "correct horse battery", secondary: "correct horse battery" });
    expect(test.prompt().submit?.disabled).toBe(false);
  });

  it("reports the outcome rather than closing on a change nothing else shows", async () => {
    const test = harness();
    test.open("set-password");
    test.type({ text: "correct horse battery", secondary: "correct horse battery" });
    test.prompt().submit?.run();
    await flush();
    expect(test.actions.setPassword).toHaveBeenCalledWith({ password: "correct horse battery" });
    const prompt = test.prompt();
    expect(prompt.message).toBe("Your password was saved.");
    expect(prompt.submit).toBeNull();
    expect(prompt.fields).toEqual([]);
    expect(prompt.dismiss.label).toBe("Done");
    prompt.dismiss.run();
    expect(test.draft()).toBeNull();
  });
});

describe("TOTP enrolment", () => {
  it("shows the secret once, only in the enrolment prompt, and never before", async () => {
    const test = harness();
    test.open("enroll-totp");
    // Nothing is requested by opening the screen.
    expect(test.prompt().enrollment).toBeNull();
    expect(test.actions.beginTotpEnrollment).not.toHaveBeenCalled();

    test.prompt().submit?.run();
    await flush();
    expect(test.actions.beginTotpEnrollment).toHaveBeenCalledTimes(1);

    const enrolling = test.prompt();
    expect(enrolling.enrollment).toEqual({
      secretBase32: "JBSWY3DPEHPK3PXP",
      provisioningUri: "otpauth://totp/Ryco:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Ryco",
    });
    expect(enrolling.message).toContain("displayed once");
    expect(enrolling.fields.map((field) => field.key)).toEqual(["text"]);
    // Nothing outside the prompt sees it.
    const view = test.view();
    expect(JSON.stringify(view.sections)).not.toContain("JBSWY3DPEHPK3PXP");
    expect(JSON.stringify(view.passkeyRows)).not.toContain("JBSWY3DPEHPK3PXP");
  });

  /** The secret must not outlive the screen that exists to display it. */
  it("drops the secret on every close path", async () => {
    const test = harness();
    test.open("enroll-totp");
    test.prompt().submit?.run();
    await flush();
    expect(test.prompt().enrollment).not.toBeNull();

    test.prompt().dismiss.run();
    expect(test.actions.dismissTotpEnrollment).toHaveBeenCalledTimes(1);
    expect(test.draft()).toBeNull();
    expect(test.view().prompt).toBeNull();
  });

  it("confirms with the code from the app and reports that it is on", async () => {
    const test = harness();
    test.open("enroll-totp");
    test.prompt().submit?.run();
    await flush();

    expect(test.prompt().submit?.disabled).toBe(true);
    test.type({ text: "12345" });
    expect(test.prompt().submit?.disabled).toBe(true);
    test.type({ text: " 123456 " });
    expect(test.prompt().submit?.disabled).toBe(false);

    test.prompt().submit?.run();
    await flush();
    expect(test.actions.confirmTotpEnrollment).toHaveBeenCalledWith({ code: "123456" });
    const prompt = test.prompt();
    expect(prompt.message).toContain("Two-factor authentication is on");
    expect(prompt.enrollment).toBeNull();
    expect(prompt.submit).toBeNull();
  });

  it("says a passkey session is required, without offering a shortcut", () => {
    const test = harness();
    const section = test.view().sections.find((candidate) => candidate.id === "two-factor");
    expect(section?.footnote).toContain("passkey session");
    test.open("enroll-totp");
    expect(test.prompt().message).toContain("passkey session on this device");
  });
});

describe("email verification", () => {
  it("says the Hub cannot deliver mail rather than letting the user wait", async () => {
    const test = harness();
    const section = test.view().sections.find((candidate) => candidate.id === "email");
    expect(section?.footnote).toContain("no mail transport configured");
    expect(section?.footnote).toContain("no message will arrive");

    test.open("verify-email");
    expect(test.prompt().notice).toContain("discarded rather than delivered");

    test.type({ text: "ada@example.com" });
    test.prompt().submit?.run();
    await flush();
    expect(test.actions.requestEmailVerification).toHaveBeenCalledWith({
      email: "ada@example.com",
    });
    // The Hub answers 202 uniformly, so the copy claims acceptance, never that
    // the address is known — and never that a message is on its way.
    expect(test.prompt().message).toBe(
      "Your Hub accepted the request. It cannot deliver mail yet, so no message will arrive.",
    );
  });

  it("will not submit an address that is obviously not one", () => {
    const test = harness();
    test.open("verify-email");
    for (const value of ["", "ada", "ada@example", "ada @example.com", "a@b@example.com"]) {
      test.type({ text: value });
      expect(test.prompt().submit?.disabled, value).toBe(true);
    }
    test.type({ text: "ada@example.com" });
    expect(test.prompt().submit?.disabled).toBe(false);
  });
});

describe("errors", () => {
  it("shows a store message on the screen, but never inside a prompt that has not run", () => {
    const test = harness({ account: { errorMessage: "Hub is temporarily unavailable." } });
    expect(test.view().errorMessage).toBe("Hub is temporarily unavailable.");
    test.open("set-password");
    // The prompt has attempted nothing, so the leftover message is not its own.
    expect(test.prompt().errorMessage).toBeNull();
    // And a single refusal is never rendered twice.
    expect(test.view().errorMessage).toBeNull();
  });

  it("explains an unreadable passkey list instead of showing an empty one", () => {
    expect(
      harness({ account: { passkeys: [], passkeysStatus: "stale" } }).view().passkeysEmptyDetail,
    ).toBe("The passkey list could not be loaded.");
    expect(
      harness({ account: { passkeys: [], passkeysStatus: "ready" } }).view().passkeysEmptyDetail,
    ).toBe("No passkeys are registered on this account yet.");
    expect(
      harness({ account: { passkeys: [], passkeysStatus: "loading" } }).view().passkeysEmptyDetail,
    ).toBe("Loading your passkeys.");
  });
});

/**
 * The falsifiable security assertion for this surface: no view model carries
 * session material, and the only secret it may carry — the TOTP enrolment key —
 * appears in exactly one place, the enrolment prompt.
 */
describe("no unexpected secret material reaches a view model", () => {
  const SECRET_KEY_PATTERN =
    /token|proof|jwk|jws|jwt|\bath\b|\bjti\b|ticket|csrf|cookie|bearer|dpop|authorization|password/i;

  function walk(value: unknown, keys: string[], strings: string[]): void {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, keys, strings);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      walk(child, keys, strings);
    }
  }

  it("exposes no credential-shaped key on the surface or any prompt", async () => {
    const ids: ReadonlyArray<HostedAccountPromptId> = [
      "add-passkey",
      "revoke-passkey",
      "regenerate-recovery-codes",
      "set-password",
      "remove-password",
      "enroll-totp",
      "revoke-totp",
      "verify-email",
    ];
    for (const id of ids) {
      const test = harness();
      test.open(id);
      if (id === "enroll-totp") {
        test.prompt().submit?.run();
        await flush();
      }
      const keys: string[] = [];
      walk(test.view(), keys, []);
      const offenders = keys.filter((key) => SECRET_KEY_PATTERN.test(key));
      expect(offenders, `prompt ${id}`).toEqual([]);
    }
  });

  it("keeps a typed password out of the view model it renders from", () => {
    const test = harness();
    test.open("set-password");
    test.type({ text: "correct horse battery", secondary: "correct horse battery" });
    const keys: string[] = [];
    walk(test.view(), keys, []);
    // The value rides the field's `value` slot, which is what a controlled
    // input requires — but nothing is stored under a credential-shaped key, and
    // no title, message, notice, or error echoes it.
    const prompt = test.prompt();
    const copy = [
      prompt.title,
      prompt.message,
      prompt.notice ?? "",
      prompt.errorMessage ?? "",
    ].join(" ");
    expect(copy).not.toContain("correct horse battery");
    expect(keys.filter((key) => key === "password")).toEqual([]);
  });
});

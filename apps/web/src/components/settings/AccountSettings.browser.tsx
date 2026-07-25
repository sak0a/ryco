// Behaviour of the hosted account settings surface, against the real runtime
// stores with only the controller's network-touching actions stubbed.
//
// What is pinned here is not markup. It is the four things that would be a
// security defect rather than a cosmetic one:
//
//   * a destructive action never fires before an explicit confirmation;
//   * a TOTP field appears only after the Hub has demanded a step-up, and the
//     retry actually carries the code;
//   * secret material never reaches a persisted store or the URL;
//   * a dismissed or torn-down secret is cleared from the runtime, not merely
//     hidden.
import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";
import {
  HostedHubApiError,
  STEP_UP_REQUIRED_CODE,
  type HostedHubPasskey,
} from "@ryco/client-runtime/authorization";

import { hostedAccountStore, hostedHubController, hostedHubStore } from "../../hostedHub/state";
import { useRecoveryCodeDisplayStore } from "../../hostedHub/recoveryCodeDisplay";
import { AccountSettingsPanel } from "./AccountSettings";

const STEP_UP_MESSAGE = new HostedHubApiError(STEP_UP_REQUIRED_CODE, 403).message;

const RECOVERY_CODES = [
  "aaaa-1111-bbbb",
  "cccc-2222-dddd",
  "eeee-3333-ffff",
  "gggg-4444-hhhh",
] as const;

const TOTP_SECRET = "JBSWY3DPEHPK3PXPZZZZ";
const TOTP_URI = `otpauth://totp/Ryco:ada@example.com?secret=${TOTP_SECRET}&issuer=Ryco`;

const ACCOUNT = {
  id: "acct_aaaaaaaaaaaaaaaaaaaaaa",
  displayName: "Ada",
  role: "owner" as const,
  createdAt: 1_700_000_000_000,
  disabledAt: null,
};

const SESSION = {
  id: "sess_aaaaaaaaaaaaaaaaaaaaaa",
  accountId: ACCOUNT.id,
  createdAt: 1_700_000_000_000,
  expiresAt: 1_800_000_000_000,
  lastSeenAt: 1_700_000_000_000,
  revokedAt: null,
  revocationReasonCode: null,
};

function passkey(overrides: Partial<HostedHubPasskey> = {}): HostedHubPasskey {
  return {
    id: "pkey_aaaaaaaaaaaaaaaaaaaaaa",
    label: "Work laptop",
    createdAt: 1_700_000_000_000,
    lastUsedAt: 1_700_000_500_000,
    backupEligible: true,
    backupState: true,
    revokedAt: null,
    revocationReasonCode: null,
    ...overrides,
  };
}

/** Everything the browser would still be holding after a reload. */
function persistedStorageSnapshot(): string {
  const parts: Array<string> = [];
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null) continue;
      parts.push(key, storage.getItem(key) ?? "");
    }
  }
  return parts.join("\n");
}

type Mounted = Awaited<ReturnType<typeof render>> & {
  cleanup?: () => Promise<void>;
  unmount?: () => Promise<void>;
};

describe("AccountSettingsPanel", () => {
  let mounted: Mounted | null = null;
  let clipboard: Array<string> = [];

  const mount = async () => {
    mounted = await render(<AccountSettingsPanel />);
    return mounted;
  };

  const teardown = async () => {
    if (!mounted) return;
    const stop = mounted.cleanup ?? mounted.unmount;
    await stop?.call(mounted).catch(() => undefined);
    mounted = null;
  };

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    clipboard = [];
    hostedHubStore.setState(
      {
        ...hostedHubStore.getInitialState(),
        accountStatus: "authenticated",
        account: ACCOUNT,
        session: SESSION,
      },
      true,
    );
    hostedAccountStore.setState(
      { ...hostedAccountStore.getInitialState(), passkeys: [passkey()], passkeysStatus: "ready" },
      true,
    );
    useRecoveryCodeDisplayStore.setState({ claims: 0 });
    // The mount read is a read; it must never be the thing that reaches the Hub
    // in a test about mutations.
    vi.spyOn(hostedHubController, "refreshPasskeys").mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          clipboard.push(value);
          return Promise.resolve();
        },
      },
    });
  });

  afterEach(async () => {
    await teardown();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  /* ------------------------------------------- destructive actions confirm */

  it("rotates recovery codes only after an explicit confirmation that says what it destroys", async () => {
    const regenerate = vi
      .spyOn(hostedHubController, "regenerateRecoveryCodes")
      .mockImplementation(async () => {
        hostedHubStore.setState({ recoveryCodes: [...RECOVERY_CODES] });
        hostedAccountStore.setState({ errorMessage: null });
      });

    await mount();
    await page.getByRole("button", { name: "Generate new codes" }).click();

    expect(
      regenerate,
      "the trigger opens a confirmation; it must not rotate on its own",
    ).not.toHaveBeenCalled();
    await expect
      .element(page.getByText(/Every code you have already saved stops working immediately/i))
      .toBeVisible();

    await page.getByRole("button", { name: "Replace codes" }).click();
    expect(regenerate).toHaveBeenCalledOnce();
  });

  it("leaves the saved codes alone when the confirmation is declined", async () => {
    const regenerate = vi.spyOn(hostedHubController, "regenerateRecoveryCodes").mockResolvedValue();

    await mount();
    await page.getByRole("button", { name: "Generate new codes" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect
      .element(page.getByText(/Every code you have already saved stops working/i))
      .not.toBeInTheDocument();
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("never rotates recovery codes as a side effect of mounting the surface", async () => {
    const regenerate = vi.spyOn(hostedHubController, "regenerateRecoveryCodes").mockResolvedValue();

    await mount();
    await expect.element(page.getByText("One-time recovery codes")).toBeVisible();

    expect(regenerate).not.toHaveBeenCalled();
  });

  it("revokes a passkey only after an explicit confirmation", async () => {
    const revoke = vi.spyOn(hostedHubController, "revokePasskey").mockResolvedValue();

    await mount();
    await page.getByRole("button", { name: "Revoke Work laptop" }).click();

    expect(revoke).not.toHaveBeenCalled();
    await expect.element(page.getByText(/will stop working immediately/i)).toBeVisible();

    await page.getByRole("button", { name: "Revoke passkey" }).click();
    expect(revoke).toHaveBeenCalledWith("pkey_aaaaaaaaaaaaaaaaaaaaaa");
  });

  /* -------------------------------------------------------- step-up retry */

  it("asks for a TOTP code only after the Hub demands one, then retries with it", async () => {
    const attempts: Array<{ readonly email: string; readonly totpCode?: string }> = [];
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async (input) => {
      attempts.push(input);
      hostedAccountStore.setState({
        errorMessage: input.totpCode === undefined ? STEP_UP_MESSAGE : null,
      });
    });

    await mount();

    // A passkey session must never be shown a code field up front — and the
    // client cannot tell which kind of session it is on, so "up front" means
    // "before the Hub has said so".
    await expect
      .element(page.getByRole("textbox", { name: "Authenticator code" }))
      .not.toBeInTheDocument();

    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();

    await expect.element(page.getByText("Confirm the email change")).toBeVisible();
    expect(attempts).toEqual([{ email: "ada@example.com" }]);

    await page.getByRole("textbox", { name: "Authenticator code" }).fill("123 456");
    await page.getByRole("button", { name: "Confirm code" }).click();

    expect(attempts).toEqual([
      { email: "ada@example.com" },
      { email: "ada@example.com", totpCode: "123456" },
    ]);
    await expect.element(page.getByText("Confirm the email change")).not.toBeInTheDocument();
    await expect.element(page.getByText(/Request accepted by the Hub/i)).toBeVisible();
  });

  it("re-prompts on a rejected code instead of reporting success", async () => {
    const codes: Array<string | undefined> = [];
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async (input) => {
      codes.push(input.totpCode);
      hostedAccountStore.setState({
        errorMessage: input.totpCode === "654321" ? null : STEP_UP_MESSAGE,
      });
    });

    await mount();
    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();
    await expect.element(page.getByText("Confirm the email change")).toBeVisible();

    await page.getByRole("textbox", { name: "Authenticator code" }).fill("111111");
    await page.getByRole("button", { name: "Confirm code" }).click();

    // Still open, and the copy no longer claims to know why it failed.
    await expect.element(page.getByText(/That code was not accepted/i)).toBeVisible();
    await expect.element(page.getByText(/Request accepted by the Hub/i)).not.toBeInTheDocument();

    await page.getByRole("textbox", { name: "Authenticator code" }).fill("654321");
    await page.getByRole("button", { name: "Confirm code" }).click();

    expect(codes).toEqual([undefined, "111111", "654321"]);
    await expect.element(page.getByText(/Request accepted by the Hub/i)).toBeVisible();
  });

  it("never opens a step-up prompt for a session the Hub accepts", async () => {
    vi.spyOn(hostedHubController, "requestEmailVerification").mockImplementation(async () => {
      hostedAccountStore.setState({ errorMessage: null });
    });

    await mount();
    await page.getByRole("textbox", { name: "Email address" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Send verification" }).click();

    await expect.element(page.getByText(/Request accepted by the Hub/i)).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Authenticator code" }))
      .not.toBeInTheDocument();
  });

  it("does not offer a step-up out of the passkey-session gate", async () => {
    vi.spyOn(hostedHubController, "beginTotpEnrollment").mockImplementation(async () => {
      hostedAccountStore.setState({
        errorMessage: "Sign in with a passkey on this device to change two-factor settings.",
      });
    });

    await mount();
    await page.getByRole("button", { name: "Set up" }).click();

    await expect.element(page.getByText(/Sign in with a passkey on this device/i)).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Authenticator code" }))
      .not.toBeInTheDocument();
  });

  /* ------------------------------------------------------ secret handling */

  it("shows recovery codes once, with copy, and never writes them to a persisted store", async () => {
    vi.spyOn(hostedHubController, "regenerateRecoveryCodes").mockImplementation(async () => {
      hostedHubStore.setState({ recoveryCodes: [...RECOVERY_CODES] });
      hostedAccountStore.setState({ errorMessage: null });
    });

    await mount();
    await page.getByRole("button", { name: "Generate new codes" }).click();
    await page.getByRole("button", { name: "Replace codes" }).click();

    await expect.element(page.getByText(RECOVERY_CODES[0])).toBeVisible();

    const persisted = persistedStorageSnapshot();
    for (const code of RECOVERY_CODES) {
      expect(persisted, `recovery code ${code} reached a persisted store`).not.toContain(code);
      expect(window.location.href).not.toContain(code);
    }

    await page.getByRole("button", { name: "Copy codes" }).click();
    expect(clipboard).toEqual([RECOVERY_CODES.join("\n")]);
  });

  it("clears the codes from the runtime when they are dismissed, not just from the screen", async () => {
    vi.spyOn(hostedHubController, "regenerateRecoveryCodes").mockImplementation(async () => {
      hostedHubStore.setState({ recoveryCodes: [...RECOVERY_CODES] });
      hostedAccountStore.setState({ errorMessage: null });
    });

    await mount();
    await page.getByRole("button", { name: "Generate new codes" }).click();
    await page.getByRole("button", { name: "Replace codes" }).click();
    await expect.element(page.getByText(RECOVERY_CODES[0])).toBeVisible();

    await page.getByRole("button", { name: "I saved the codes" }).click();

    await expect.element(page.getByText(RECOVERY_CODES[0])).not.toBeInTheDocument();
    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
  });

  it("drops both held secrets when the surface goes away", async () => {
    await mount();
    hostedHubStore.setState({
      recoveryCodes: [...RECOVERY_CODES],
      totpEnrollment: { secretBase32: TOTP_SECRET, provisioningUri: TOTP_URI },
    });
    await expect.element(page.getByText(RECOVERY_CODES[0])).toBeVisible();

    await teardown();

    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
    expect(hostedHubStore.getState().totpEnrollment).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(TOTP_SECRET);
  });

  it("shows the TOTP enrolment key once and clears it on dismissal", async () => {
    await mount();
    hostedHubStore.setState({
      totpEnrollment: { secretBase32: TOTP_SECRET, provisioningUri: TOTP_URI },
    });

    await expect.element(page.getByLabelText("Two-factor setup key")).toBeVisible();
    await expect.element(page.getByLabelText("Two-factor setup code")).toBeVisible();

    const persisted = persistedStorageSnapshot();
    expect(persisted).not.toContain(TOTP_SECRET);
    expect(window.location.href).not.toContain(TOTP_SECRET);

    await page.getByRole("button", { name: "Cancel" }).click();

    expect(hostedHubStore.getState().totpEnrollment).toBeNull();
    await expect.element(page.getByLabelText("Two-factor setup key")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(TOTP_SECRET);
  });

  it("keeps the hosted root's full-screen code takeover out of the way while it is mounted", async () => {
    await mount();
    expect(useRecoveryCodeDisplayStore.getState().claims).toBe(1);
    await teardown();
    expect(useRecoveryCodeDisplayStore.getState().claims).toBe(0);
  });

  /* ------------------------------------------------------------------ copy */

  it("says that email verification currently delivers nothing", async () => {
    await mount();
    await expect.element(page.getByText("No mail will arrive yet")).toBeVisible();
    await expect.element(page.getByText(/no mail transport configured/i)).toBeVisible();
  });

  it("never presents a fallback credential as the equal of a passkey", async () => {
    await mount();
    await expect
      .element(page.getByText(/A password is a fallback, not an equal of a passkey/i))
      .toBeVisible();
    await expect
      .element(page.getByText(/They are a last resort, not a substitute for one/i))
      .toBeVisible();
  });

  it("reports a revoked credential rather than hiding it", async () => {
    hostedAccountStore.setState({
      passkeys: [
        passkey(),
        passkey({
          id: "pkey_bbbbbbbbbbbbbbbbbbbbbb",
          label: "Old phone",
          revokedAt: 1_700_000_900_000,
          revocationReasonCode: "device_lost",
        }),
      ],
      passkeysStatus: "ready",
    });

    await mount();
    await expect.element(page.getByText("Old phone")).toBeVisible();
    await expect.element(page.getByText(/device_lost/)).toBeVisible();
    await expect.element(page.getByText("1 usable passkey")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Revoke Old phone" }))
      .not.toBeInTheDocument();
  });
});
